import { IConfig } from '../config';
import {
  IModelColumnRepository,
  IModelRepository,
  IProjectRepository,
  IRelationRepository,
} from '../repositories';
import { IDeployLogRepository } from '../repositories/deployLogRepository';
import { IDeployService } from '../services/deployService';
import { IMDLService } from '../services/mdlService';
import { IModelService } from '../services/modelService';
import { IProjectService } from '../services/projectService';

export interface IContext {
  config: IConfig;

  // services
  projectService: IProjectService;
  modelService: IModelService;
  mdlService: IMDLService;
  deployService: IDeployService;

  // repository
  projectRepository: IProjectRepository;
  modelRepository: IModelRepository;
  modelColumnRepository: IModelColumnRepository;
  relationRepository: IRelationRepository;
  deployRepository: IDeployLogRepository;
}
