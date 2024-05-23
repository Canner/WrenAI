import crypto from 'crypto';
import * as fs from 'fs';
import path from 'path';
import { Encryptor, getLogger } from '@server/utils';
import { IProjectRepository } from '../repositories';
import { Project } from '../repositories';
import { getConfig } from '../config';

const config = getConfig();

const logger = getLogger('ProjectService');
logger.level = 'debug';

export interface IProjectService {
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

  constructor({ projectRepository }: { projectRepository: any }) {
    this.projectRepository = projectRepository;
  }

  public async getCurrentProject() {
    return await this.projectRepository.getCurrentProject();
  }

  public async getProjectById(projectId: number) {
    return await this.projectRepository.findOneBy({ id: projectId });
  }

  public async getCredentialFilePath(project?: Project) {
    if (!project) {
      project = await this.getCurrentProject();
    }
    const { credentials: encryptedCredentials } = project;
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
}
