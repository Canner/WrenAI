import { Knex } from 'knex';
import {
  Deploy,
  IDeployLogRepository,
  IKnowledgeBaseRepository,
  IKBSnapshotRepository,
  IModelColumnRepository,
  IModelNestedColumnRepository,
  IModelRepository,
  IProjectRepository,
  IRelationRepository,
  IWorkspaceRepository,
  KnowledgeBase,
  Workspace,
} from '../repositories';
import { IWrenEngineAdaptor } from '@server/adaptors/wrenEngineAdaptor';
import { IDashboardService } from './dashboardService';
import { IDeployService } from './deployService';
import { IMDLService } from './mdlService';
import { IModelService } from './modelService';
import { IProjectService } from './projectService';
import { SampleDatasetName } from '@server/data';

export type SampleRuntimeSeedMode =
  | 'all'
  | 'default_only'
  | 'background_all'
  | 'metadata_only';

export interface IWorkspaceBootstrapService {
  findDefaultWorkspace(options?: {
    tx?: Knex.Transaction;
  }): Promise<Workspace | null>;
  ensureDefaultWorkspaceWithSamples(options?: {
    tx?: Knex.Transaction;
    runtimeSeedMode?: SampleRuntimeSeedMode;
  }): Promise<Workspace>;
  ensureDefaultWorkspaceSampleRuntime(options: {
    sampleDataset: SampleDatasetName;
    tx?: Knex.Transaction;
  }): Promise<{
    workspace: Workspace;
    knowledgeBase: KnowledgeBase;
  }>;
}

export interface WorkspaceBootstrapServiceDependencies {
  workspaceRepository: IWorkspaceRepository;
  knowledgeBaseRepository: IKnowledgeBaseRepository;
  kbSnapshotRepository: IKBSnapshotRepository;
  projectRepository: IProjectRepository;
  projectService: IProjectService;
  modelService: IModelService;
  modelRepository: IModelRepository;
  modelColumnRepository: IModelColumnRepository;
  modelNestedColumnRepository: IModelNestedColumnRepository;
  relationRepository: IRelationRepository;
  deployService: IDeployService;
  deployLogRepository: IDeployLogRepository;
  mdlService: IMDLService;
  dashboardService: IDashboardService;
  wrenEngineAdaptor: IWrenEngineAdaptor;
}

export interface WorkspaceBootstrapRuntimeDeps
  extends WorkspaceBootstrapServiceDependencies {
  runtimeSeedJobs: Map<string, Promise<void>>;
  workspaceWarmupJobs: Map<string, Promise<void>>;
}

export interface SystemSampleRuntimeResult {
  deployment: Deploy;
}
