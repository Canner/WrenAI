import crypto from 'crypto';
import * as fs from 'fs';
import path from 'path';
import { Encryptor, getLogger } from '@server/utils';
import {
  BIG_QUERY_CONNECTION_INFO,
  DUCKDB_CONNECTION_INFO,
  POSTGRES_CONNECTION_INFO,
  IProjectRepository,
} from '../repositories';
import { Project } from '../repositories';
import { getConfig } from '../config';
import {
  CompactTable,
  IDataSourceMetadataService,
  RecommendConstraint,
} from './metadataService';
import { DataSourceName } from '../types';

const config = getConfig();

const logger = getLogger('ProjectService');
logger.level = 'debug';

const SENSITIVE_PROPERTY_NAME = new Set(['credentials', 'password']);
export interface ProjectData {
  displayName: string;
  type: DataSourceName;
  connectionInfo:
    | BIG_QUERY_CONNECTION_INFO
    | POSTGRES_CONNECTION_INFO
    | DUCKDB_CONNECTION_INFO;
}

export interface IProjectService {
  createProject: (projectData: ProjectData) => Promise<Project>;
  getSensitiveConnectionInfo: () => Set<string>;
  encryptSensitiveConnectionInfo: (
    connectionInfo:
      | BIG_QUERY_CONNECTION_INFO
      | POSTGRES_CONNECTION_INFO
      | DUCKDB_CONNECTION_INFO,
  ) => any;
  getProjectDataSourceTables: (
    project?: Project,
    projectId?: number,
  ) => Promise<CompactTable[]>;
  getProjectSuggestedConstraint: (
    project?: Project,
    projectId?: number,
  ) => Promise<RecommendConstraint[]>;

  getCurrentProject: () => Promise<Project>;
  getProjectById: (projectId: number) => Promise<Project>;
  getCredentialFilePath: (project?: Project) => Promise<string>;
  writeCredentialFile: (
    credentials: JSON,
    persistCredentialDir: string,
  ) => string;
  deleteProject: (projectId: number) => Promise<void>;
}

export class ProjectService implements IProjectService {
  private projectRepository: IProjectRepository;
  private metadataService: IDataSourceMetadataService;

  constructor({
    projectRepository,
    metadataService,
  }: {
    projectRepository: IProjectRepository;
    metadataService: IDataSourceMetadataService;
  }) {
    this.projectRepository = projectRepository;
    this.metadataService = metadataService;
  }

  public async getCurrentProject() {
    return await this.projectRepository.getCurrentProject();
  }

  public async getProjectById(projectId: number) {
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
      connectionInfo: this.encryptSensitiveConnectionInfo(
        projectData.connectionInfo,
      ),
    };
    logger.debug('Creating project...');
    logger.debug({ projectValue });
    const project = await this.projectRepository.createOne(projectValue);
    return project;
  }

  public async getCredentialFilePath(project?: Project) {
    if (!project) {
      project = await this.getCurrentProject();
    }
    const connectionInfo = project.connectionInfo as BIG_QUERY_CONNECTION_INFO;
    const encryptedCredentials = connectionInfo.credentials;
    const encryptor = new Encryptor(config);
    const credentials = encryptor.decrypt(encryptedCredentials);
    const filePath = this.writeCredentialFile(
      JSON.parse(credentials),
      config.persistCredentialDir,
    );
    return filePath;
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
    logger.debug(`Writing credentials to file ${filePath}`);
    fs.writeFileSync(filePath, credentialString);
    return filePath;
  }

  public async deleteProject(projectId: number): Promise<void> {
    await this.projectRepository.deleteOne(projectId);
  }

  public getSensitiveConnectionInfo() {
    return SENSITIVE_PROPERTY_NAME;
  }

  public encryptSensitiveConnectionInfo(
    connectionInfo:
      | BIG_QUERY_CONNECTION_INFO
      | POSTGRES_CONNECTION_INFO
      | DUCKDB_CONNECTION_INFO,
  ) {
    const encryptor = new Encryptor(config);
    const encryptConnectionInfo = Object.entries(connectionInfo).reduce(
      (acc, [key, value]) => {
        if (SENSITIVE_PROPERTY_NAME.has(key)) {
          const toEncrypt = key === 'password' ? { password: value } : value;
          acc[key] = encryptor.encrypt(toEncrypt);
        }
        return acc;
      },
      connectionInfo,
    );
    return encryptConnectionInfo;
  }
}
