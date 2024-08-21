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
import { ISchemaChangeRepository } from '../repositories/schemaChangeRepository';
import { IDeployLogRepository } from '../repositories/deployLogRepository';
import {
  IQueryService,
  IAskingService,
  IDeployService,
  IModelService,
  IMDLService,
  IProjectService,
} from '../services';
import { ITelemetry } from '../telemetry/telemetry';

export interface IContext {
  config: IConfig;
  // telemetry
  telemetry: ITelemetry;

  // adaptor
  wrenEngineAdaptor: IWrenEngineAdaptor;
  ibisServerAdaptor: IIbisAdaptor;

  // services
  projectService: IProjectService;
  modelService: IModelService;
  mdlService: IMDLService;
  deployService: IDeployService;
  askingService: IAskingService;
  queryService: IQueryService;

  // repository
  projectRepository: IProjectRepository;
  modelRepository: IModelRepository;
  modelColumnRepository: IModelColumnRepository;
  relationRepository: IRelationRepository;
  viewRepository: IViewRepository;
  deployRepository: IDeployLogRepository;
  schemaChangeRepository: ISchemaChangeRepository;
}
