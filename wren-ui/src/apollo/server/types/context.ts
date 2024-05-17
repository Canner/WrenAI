import { IIbisAdaptor } from '../adaptors/ibisAdaptor';
import { IWrenEngineAdaptor } from '../adaptors/wrenEngineAdaptor';
import { IConfig } from '../config';
import {
  IModelColumnRepository,
  IModelRepository,
  IProjectRepository,
  IRelationRepository,
  IViewRepository,
} from '../repositories';
import { IDeployLogRepository } from '../repositories/deployLogRepository';
import { IAskingService } from '../services/askingService';
import { IDeployService } from '../services/deployService';
import { IMDLService } from '../services/mdlService';
import { IModelService } from '../services/modelService';
import { IProjectService } from '../services/projectService';

export interface IContext {
  config: IConfig;
  // telemetry
  telemetry: any;

  // adaptor
  wrenEngineAdaptor: IWrenEngineAdaptor;
  ibisServerAdaptor: IIbisAdaptor;

  // services
  projectService: IProjectService;
  modelService: IModelService;
  mdlService: IMDLService;
  deployService: IDeployService;
  askingService: IAskingService;

  // repository
  projectRepository: IProjectRepository;
  modelRepository: IModelRepository;
  modelColumnRepository: IModelColumnRepository;
  relationRepository: IRelationRepository;
  viewRepository: IViewRepository;
  deployRepository: IDeployLogRepository;
}
