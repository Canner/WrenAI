import crypto from 'crypto';
import * as fs from 'fs';
import path from 'path';
import { getLogger } from '@server/utils';
import {
  IProjectRepository,
  WREN_AI_CONNECTION_INFO,
  WorkspaceProjectType,
} from '../repositories';
import { Project } from '../repositories';
import {
  CompactTable,
  IDataSourceMetadataService,
  RecommendConstraint,
} from './metadataService';
import { DataSourceName } from '../types';
import {
  RecommendationQuestion,
  RecommendationQuestionStatus,
  WrenAIError,
  WrenAILanguage,
} from '@server/models/adaptor';
import { encryptConnectionInfo } from '../dataSource';
import { IWrenAIAdaptor } from '../adaptors';
import { RecommendQuestionResultStatus } from './askingService';
import { IMDLService } from './mdlService';
import { ProjectRecommendQuestionBackgroundTracker } from '../backgrounds';
import { ITelemetry } from '../telemetry/telemetry';
import { getConfig } from '../config';
import { buildFastRecommendationQuestions } from '../utils/recommendationQuestions';
import { IQueryService, PreviewDataResponse } from './queryService';

const config = getConfig();

const logger = getLogger('ProjectService');
logger.level = 'debug';

const SENSITIVE_PROPERTY_NAME = new Set([
  'credentials',
  'password',
  'awsSecretKey',
  'privateKey',
  'accessToken',
  'clientSecret',
  'webIdentityToken',
]);
export interface ProjectData {
  displayName: string;
  type: DataSourceName;
  connectionInfo: WREN_AI_CONNECTION_INFO;
  projectType?: WorkspaceProjectType;
}

export type ProjectRecommendationQuestionsResult = {
  status: RecommendQuestionResultStatus;
  questions: RecommendationQuestion[];
  error: WrenAIError | null;
};
export interface IProjectService {
  createProject: (projectData: ProjectData) => Promise<Project>;
  updateProject: (
    projectId: string | number,
    projectData: Partial<Project>,
  ) => Promise<Project>;
  getGeneralConnectionInfo: (project: Project) => Record<string, any>;
  getProjectDataSourceTables: (
    project?: Project,
    projectId?: number,
  ) => Promise<CompactTable[]>;
  getProjectDataSourceVersion: (
    project?: Project,
    projectId?: number,
  ) => Promise<string>;
  getProjectSuggestedConstraint: (
    project?: Project,
    projectId?: number,
  ) => Promise<RecommendConstraint[]>;

  getCurrentProject: () => Promise<Project>;
  listProjects: () => Promise<Project[]>;
  selectProject: (projectId: string | number) => Promise<Project>;
  getProjectById: (projectId: string | number) => Promise<Project>;
  writeCredentialFile: (
    credentials: JSON,
    persistCredentialDir: string,
  ) => string;
  deleteProject: (projectId: number) => Promise<void>;
  getProjectRecommendationQuestions: () => Promise<ProjectRecommendationQuestionsResult>;

  // recommend questions
  generateProjectRecommendationQuestions: () => Promise<void>;
}

export class ProjectService implements IProjectService {
  private projectRepository: IProjectRepository;
  private metadataService: IDataSourceMetadataService;
  private mdlService: IMDLService;
  private queryService: IQueryService;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private projectRecommendQuestionBackgroundTracker: ProjectRecommendQuestionBackgroundTracker;
  private projectRecommendationJobs = new Map<string, Promise<void>>();
  constructor({
    projectRepository,
    metadataService,
    mdlService,
    queryService,
    wrenAIAdaptor,
    telemetry,
    projectRecommendQuestionBackgroundTracker,
  }: {
    projectRepository: IProjectRepository;
    metadataService: IDataSourceMetadataService;
    mdlService: IMDLService;
    queryService: IQueryService;
    wrenAIAdaptor: IWrenAIAdaptor;
    telemetry: ITelemetry;
    projectRecommendQuestionBackgroundTracker?: ProjectRecommendQuestionBackgroundTracker;
  }) {
    this.projectRepository = projectRepository;
    this.metadataService = metadataService;
    this.mdlService = mdlService;
    this.queryService = queryService;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.projectRecommendQuestionBackgroundTracker =
      projectRecommendQuestionBackgroundTracker ??
      new ProjectRecommendQuestionBackgroundTracker({
        projectRepository,
        telemetry,
        wrenAIAdaptor,
      });
  }

  public dispose(): void {
    this.projectRecommendQuestionBackgroundTracker.stop();
  }
  public async updateProject(
    projectId: string | number,
    projectData: Partial<Project>,
  ): Promise<Project> {
    return await this.projectRepository.updateOne(projectId, projectData);
  }

  public async getProjectDataSourceVersion(
    project?: Project,
    projectId?: number,
  ): Promise<string> {
    const usedProject = project
      ? project
      : projectId
        ? await this.getProjectById(projectId)
        : await this.getCurrentProject();
    return await this.metadataService.getVersion(usedProject);
  }

  public async generateProjectRecommendationQuestions(): Promise<void> {
    const project = await this.getCurrentProject();
    if (!project) {
      throw new Error(`Project not found`);
    }

    const projectJobKey = String(project.id);
    const existingJob = this.projectRecommendationJobs.get(projectJobKey);
    if (existingJob) {
      logger.debug(
        `project "${project.id}" recommended questions are already being requested, reusing in-flight job`,
      );
      return existingJob;
    }

    const job = this.doGenerateProjectRecommendationQuestions(project);
    this.projectRecommendationJobs.set(projectJobKey, job);
    try {
      return await job;
    } finally {
      this.projectRecommendationJobs.delete(projectJobKey);
    }
  }

  private async doGenerateProjectRecommendationQuestions(
    project: Project,
  ): Promise<void> {
    const { manifest } = await this.mdlService.makeModelMDL(project);
    const fastQuestions = await this.filterExecutableRecommendationQuestions(
      buildFastRecommendationQuestions(
        manifest,
        this.getProjectRecommendationQuestionsConfig(project).maxQuestions,
      ),
      project,
      manifest,
      this.getProjectRecommendationQuestionsConfig(project).maxQuestions,
    );
    if (fastQuestions.length) {
      await this.projectRepository.updateOne(project.id, {
        queryId: `fast-project-${project.id}-${Date.now()}`,
        questionsStatus: RecommendationQuestionStatus.FINISHED,
        questions: fastQuestions,
        questionsError: null,
      });
      return;
    }

    const recommendQuestionResult =
      await this.wrenAIAdaptor.generateRecommendationQuestions({
        manifest,
        projectId: project.id.toString(),
        ...this.getProjectRecommendationQuestionsConfig(project),
      });

    const updatedProject = await this.projectRepository.updateOne(project.id, {
      queryId: recommendQuestionResult.queryId,
      questionsStatus: RecommendationQuestionStatus.GENERATING,
      questions: [],
      questionsError: null,
    });

    if (
      !this.projectRecommendQuestionBackgroundTracker.isExist(updatedProject)
    ) {
      this.projectRecommendQuestionBackgroundTracker.addTask(updatedProject);
    } else {
      logger.debug(
        `Generate Project Recommendation Questions Task ${updatedProject.id} already exists, skip adding`,
      );
    }
  }

  public async getProjectRecommendationQuestions() {
    const project = await this.projectRepository.getCurrentProject();
    if (!project) {
      throw new Error(`Project not found`);
    }
    const result: ProjectRecommendationQuestionsResult = {
      status: RecommendQuestionResultStatus.NOT_STARTED,
      questions: [],
      error: null,
    };
    if (project.queryId) {
      result.status = project.questionsStatus
        ? RecommendQuestionResultStatus[project.questionsStatus]
        : result.status;
      result.questions = project.questions || [];
      result.error = project.questionsError as WrenAIError;
    }
    return result;
  }

  public async getCurrentProject() {
    return await this.projectRepository.getCurrentProject();
  }

  public async listProjects() {
    return await this.projectRepository.listProjects();
  }

  public async selectProject(projectId: string | number) {
    logger.debug(`Selecting active project ${String(projectId)}`);
    return await this.projectRepository.setCurrentProject(projectId);
  }

  public async getProjectById(projectId: string | number) {
    return await this.projectRepository.findOneBy({ id: projectId });
  }

  public async getProjectDataSourceTables(
    project?: Project,
    projectId?: number,
  ) {
    const usedProject = project
      ? project
      : projectId
        ? await this.getProjectById(projectId)
        : await this.getCurrentProject();
    return await this.metadataService.listTables(usedProject);
  }

  public async getProjectSuggestedConstraint(
    project?: Project,
    projectId?: number,
  ) {
    const usedProject = project
      ? project
      : projectId
        ? await this.getProjectById(projectId)
        : await this.getCurrentProject();
    return await this.metadataService.listConstraints(usedProject);
  }

  public async createProject(projectData: ProjectData) {
    const projectValue = {
      displayName: projectData.displayName,
      type: projectData.type,
      catalog: 'wrenai',
      schema: 'public',
      projectType: projectData.projectType || WorkspaceProjectType.CLASSIC,
      isCurrent: false,
      connectionInfo: encryptConnectionInfo(
        projectData.type,
        projectData.connectionInfo,
      ),
    };
    logger.debug('Creating project...');
    const project = await this.projectRepository.createOne(projectValue);
    return await this.projectRepository.setCurrentProject(project.id);
  }

  public writeCredentialFile(credentials: JSON, persistCredentialDir: string) {
    // create persist_credential_dir if not exists
    if (!fs.existsSync(persistCredentialDir)) {
      fs.mkdirSync(persistCredentialDir, { recursive: true });
    }
    // file name will be the hash of the credentials, file path is current working directory
    // convert credentials from base64 to string and replace all the matched "\n" with "\\n",  there are many \n in the "private_key" property
    const credentialString = JSON.stringify(credentials);
    const fileName = crypto
      .createHash('md5')
      .update(credentialString)
      .digest('hex');

    const filePath = path.join(persistCredentialDir, `${fileName}.json`);
    // check if file exists
    if (fs.existsSync(filePath)) {
      logger.debug(`File ${filePath} already exists`);
      return filePath;
    }
    fs.writeFileSync(filePath, credentialString);
    logger.debug(`Wrote credentials to file`);
    return filePath;
  }

  public async deleteProject(projectId: number): Promise<void> {
    const [projectToDelete, currentProject, remainingProjects] =
      await Promise.all([
        this.projectRepository.findOneBy({ id: projectId }),
        this.projectRepository.findCurrentProject(),
        this.projectRepository.listProjects(),
      ]);

    await this.projectRepository.deleteOne(projectId);

    if (currentProject?.id !== projectId) {
      return;
    }

    const nextProject = remainingProjects
      .filter((project) => String(project.id) !== String(projectId))
      .sort((a, b) => this.compareProjectIdsDescending(a.id, b.id))[0];

    if (nextProject) {
      await this.projectRepository.setCurrentProject(nextProject.id);
      return;
    }

    if (projectToDelete) {
      logger.debug(
        `Deleted the last current project ${projectToDelete.id}; no active project remains.`,
      );
    }
  }

  public getGeneralConnectionInfo(project) {
    return Object.entries(project.connectionInfo).reduce(
      (acc, [key, value]) => {
        if (!SENSITIVE_PROPERTY_NAME.has(key)) {
          acc[key] = value;
        }
        return acc;
      },
      {},
    );
  }

  private async filterExecutableRecommendationQuestions(
    questions: RecommendationQuestion[],
    project: Project,
    manifest: any,
    maxQuestions: number,
  ): Promise<RecommendationQuestion[]> {
    const validQuestions: RecommendationQuestion[] = [];
    for (const question of questions) {
      try {
        const result = (await this.queryService.preview(question.sql, {
          project,
          manifest,
          modelingOnly: false,
          limit: 1,
          cacheEnabled: false,
        })) as PreviewDataResponse;
        if (result?.data?.length) {
          validQuestions.push(question);
          if (validQuestions.length >= maxQuestions) {
            break;
          }
        }
      } catch (error) {
        logger.warn(
          `Skipping project recommended question because SQL preview failed: ${question.question}. ${error}`,
        );
      }
    }
    return validQuestions;
  }

  private getProjectRecommendationQuestionsConfig(project: Project) {
    return {
      maxCategories: config.projectRecommendationQuestionMaxCategories,
      maxQuestions: config.projectRecommendationQuestionsMaxQuestions,
      regenerate: true,
      configuration: {
        language: WrenAILanguage[project.language] || WrenAILanguage.EN,
      },
    };
  }

  private compareProjectIdsDescending(
    left: string | number,
    right: string | number,
  ) {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    if (leftId === rightId) {
      return 0;
    }
    return leftId > rightId ? -1 : 1;
  }
}
