import {
  DataSource,
  IContext,
  RelationData,
  SampleDatasetData,
} from '../types';
import { Connector, KnowledgeBase, Project } from '../repositories';

export interface ProjectControllerMutationDeps {
  getCurrentRuntimeScopeId: (ctx: IContext) => string | null;
  getCurrentPersistedRuntimeIdentity: (ctx: IContext) => any;
  toAskRuntimeIdentity: (runtimeIdentity: any) => any;
  assertKnowledgeBaseWriteAccess: (ctx: IContext) => Promise<void>;
  resolveActiveRuntimeKnowledgeBase: (
    ctx: IContext,
  ) => Promise<KnowledgeBase | null>;
  resolveKnowledgeBaseConnectionConnector: (
    ctx: IContext,
    knowledgeBase?: KnowledgeBase | null,
  ) => Promise<Connector | null>;
  resolveActiveRuntimeProject: (ctx: IContext) => Promise<Project | null>;
  getActiveRuntimeProjectOrThrow: (ctx: IContext) => Promise<Project>;
  isManagedFederatedRuntimeProject: (
    project?: Project | null,
    knowledgeBase?: KnowledgeBase | null,
  ) => boolean;
  upsertKnowledgeBaseConnectorForConnection: (args: {
    ctx: IContext;
    knowledgeBase: KnowledgeBase;
    connection: DataSource;
    mode: 'save' | 'update';
  }) => Promise<Connector | null>;
  createProjectFromConnection: (
    connection: DataSource,
    ctx: IContext,
  ) => Promise<Project>;
  overwriteModelsAndColumns: (
    tables: string[],
    ctx: IContext,
    project: Project,
  ) => Promise<{ models: any[]; columns: any[] }>;
  buildRelationInput: (
    relations: any[],
    models: any[],
    columns: any[],
  ) => RelationData[];
  deploy: (ctx: IContext, project: Project) => Promise<any>;
  recordKnowledgeBaseWriteAudit: (
    ctx: IContext,
    args: {
      resourceType: string;
      resourceId?: string | number | null;
      afterJson?: Record<string, any> | null;
      payloadJson?: Record<string, any> | null;
    },
  ) => Promise<void>;
  ensureModelsBelongToActiveRuntime: (
    ctx: IContext,
    modelIds: number[],
    projectId: number,
  ) => Promise<void>;
  buildDuckDbEnvironment: (
    ctx: IContext,
    options: {
      initSql: string;
      extensions: string[];
      configurations: Record<string, any>;
    },
  ) => Promise<void>;
}

export type UpdateCurrentProjectArgs = {
  language: string;
  ctx: IContext;
};

export type ResetCurrentProjectArgs = {
  ctx: IContext;
};

export type SaveConnectionArgs = {
  args: { data: DataSource };
  ctx: IContext;
};

export type UpdateConnectionArgs = SaveConnectionArgs;

export type StartSampleDatasetArgs = {
  args: { data: SampleDatasetData };
  ctx: IContext;
};

export type SaveTablesArgs = {
  args: { data: { tables: string[] } };
  ctx: IContext;
};

export type SaveRelationsArgs = {
  args: { data: { relations: RelationData[] } };
  ctx: IContext;
};

export type TriggerConnectionDetectionArgs = {
  ctx: IContext;
};
