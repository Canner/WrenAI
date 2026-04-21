import crypto from 'crypto';
import * as fs from 'fs';
import path from 'path';
import { getLogger } from '@server/utils';
import { IProjectRepository, WREN_AI_CONNECTION_INFO } from '../repositories';
import { Project } from '../repositories';
import {
  CompactTable,
  IConnectionMetadataService,
  RecommendConstraint,
} from './metadataService';
import { DataSourceName } from '../types';
import {
  RecommendationQuestion,
  RecommendationQuestionStatus,
  WrenAIError,
  WrenAILanguage,
  AskRuntimeIdentity,
} from '@server/models/adaptor';
import { encryptConnectionInfo } from '../dataSource';
import { IWrenAIAdaptor } from '../adaptors';
import { RecommendQuestionResultStatus } from './askingService';
import { IMDLService } from './mdlService';
import { ProjectRecommendQuestionBackgroundTracker } from '../backgrounds';
import { ITelemetry } from '../telemetry/telemetry';
import { getConfig } from '../config';

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
}

export interface ProjectRecommendationQuestionsResult {
  status: RecommendQuestionResultStatus;
  questions: RecommendationQuestion[];
  error: WrenAIError | null;
}
export interface IProjectService {
  createProject: (projectData: ProjectData) => Promise<Project>;
  updateProject: (
    projectId: number,
    projectData: Partial<Project>,
  ) => Promise<Project>;
  getGeneralConnectionInfo: (project: Project) => Record<string, any>;
  getProjectConnectionTables: (project: Project) => Promise<CompactTable[]>;
  getProjectConnectionVersion: (project: Project) => Promise<string>;
  getProjectSuggestedConstraint: (
    project: Project,
  ) => Promise<RecommendConstraint[]>;

  getProjectById: (projectId: number) => Promise<Project>;
  writeCredentialFile: (
    credentials: JSON,
    persistCredentialDir: string,
  ) => string;
  deleteProject: (projectId: number) => Promise<void>;
  getProjectRecommendationQuestions: (
    projectId: number,
  ) => Promise<ProjectRecommendationQuestionsResult>;

  // recommend questions
  generateProjectRecommendationQuestions: (
    projectId: number,
    runtimeScopeId?: string | null,
  ) => Promise<void>;
  stopBackgroundTrackers: () => void;
}

export class ProjectService implements IProjectService {
  private projectRepository: IProjectRepository;
  private metadataService: IConnectionMetadataService;
  private mdlService: IMDLService;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private projectRecommendQuestionBackgroundTracker: ProjectRecommendQuestionBackgroundTracker;
  constructor({
    projectRepository,
    metadataService,
    mdlService,
    wrenAIAdaptor,
    telemetry,
  }: {
    projectRepository: IProjectRepository;
    metadataService: IConnectionMetadataService;
    mdlService: IMDLService;
    wrenAIAdaptor: IWrenAIAdaptor;
    telemetry: ITelemetry;
  }) {
    this.projectRepository = projectRepository;
    this.metadataService = metadataService;
    this.mdlService = mdlService;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.projectRecommendQuestionBackgroundTracker =
      new ProjectRecommendQuestionBackgroundTracker({
        projectRepository,
        telemetry,
        wrenAIAdaptor,
      });
  }

  public stopBackgroundTrackers(): void {
    this.projectRecommendQuestionBackgroundTracker.stop();
  }

  public async updateProject(
    projectId: number,
    projectData: Partial<Project>,
  ): Promise<Project> {
    return await this.projectRepository.updateOne(projectId, projectData);
  }

  public async getProjectConnectionVersion(project: Project): Promise<string> {
    return await this.metadataService.getVersion(project);
  }

  public async generateProjectRecommendationQuestions(
    projectId: number,
    runtimeScopeId?: string | null,
  ): Promise<void> {
    const project = await this.getProjectById(projectId);
    if (!project) {
      throw new Error(`Project not found`);
    }
    const { manifest } = await this.mdlService.makeCurrentModelMDL(project.id);
    const recommendQuestionResult =
      await this.wrenAIAdaptor.generateRecommendationQuestions({
        manifest,
        runtimeScopeId: runtimeScopeId || undefined,
        runtimeIdentity: {
          projectId: project.id,
        } as AskRuntimeIdentity,
        ...this.getProjectRecommendationQuestionsConfig(project),
      });

    const updatedProject = await this.projectRepository.updateOne(project.id, {
      queryId: recommendQuestionResult.queryId,
      questionsStatus: RecommendationQuestionStatus.GENERATING,
      questions: [],
      questionsError: undefined,
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

  public async getProjectRecommendationQuestions(projectId: number) {
    const project = await this.getProjectById(projectId);
    if (!project) {
      throw new Error(`Project not found`);
    }
    const result: ProjectRecommendationQuestionsResult = {
      status: RecommendQuestionResultStatus.NOT_STARTED,
      questions: [],
      error: null,
    };
    if (project.queryId) {
      if (
        project.questionsStatus &&
        project.questionsStatus in RecommendQuestionResultStatus
      ) {
        const statusKey =
          project.questionsStatus as keyof typeof RecommendQuestionResultStatus;
        result.status = RecommendQuestionResultStatus[statusKey];
      }
      result.questions = project.questions || [];
      result.error = (project.questionsError || null) as WrenAIError | null;
    }
    return result;
  }

  public async getProjectById(projectId: number): Promise<Project> {
    const project = await this.projectRepository.findOneBy({ id: projectId });
    if (!project) {
      throw new Error(`Project not found`);
    }
    return project;
  }

  public async getProjectConnectionTables(project: Project) {
    return await this.metadataService.listTables(project);
  }

  public async getProjectSuggestedConstraint(project: Project) {
    return await this.metadataService.listConstraints(project);
  }

  public async createProject(projectData: ProjectData) {
    const projectValue = {
      displayName: projectData.displayName,
      type: projectData.type,
      catalog: 'wrenai',
      schema: 'public',
      connectionInfo: encryptConnectionInfo(
        projectData.type,
        projectData.connectionInfo,
      ),
    };
    logger.debug('Creating project...');
    const project = await this.projectRepository.createOne(projectValue);
    return project;
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
    await this.projectRepository.deleteOne(projectId);
  }

  public getGeneralConnectionInfo(project: Project): Record<string, unknown> {
    return Object.entries(project.connectionInfo).reduce(
      (acc, [key, value]) => {
        if (!SENSITIVE_PROPERTY_NAME.has(key)) {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, unknown>,
    );
  }

  private getProjectRecommendationQuestionsConfig(project: Project) {
    const languageKey = project.language;
    const language =
      languageKey && languageKey in WrenAILanguage
        ? WrenAILanguage[languageKey as keyof typeof WrenAILanguage]
        : WrenAILanguage.EN;
    return {
      maxCategories: config.projectRecommendationQuestionMaxCategories,
      maxQuestions: config.projectRecommendationQuestionsMaxQuestions,
      regenerate: true,
      configuration: {
        language,
      },
    };
  }
}
