import {
  DataSource,
  IContext,
  RelationData,
  SampleDatasetData,
} from '../types';
import { KnowledgeBase, Model, ModelColumn, Project } from '../repositories';
import {
  buildDuckDbEnvironmentSupport,
  buildRelationInputSupport,
  createProjectFromConnectionSupport,
  deployProjectSupport,
  ensureModelsBelongToActiveRuntimeSupport,
  overwriteModelsAndColumnsSupport,
} from './projectControllerProjectSupport';
import {
  autoGenerateRelationAction,
  getOnboardingStatusAction,
  getProjectRecommendationQuestionsAction,
  getSchemaChangeAction,
  getSettingsAction,
  listConnectionTablesAction,
} from './projectControllerReadActions';
import {
  resolveSchemaChangeAction,
  resetCurrentProjectAction,
  saveConnectionAction,
  saveRelationsAction,
  saveTablesAction,
  startSampleDatasetAction,
  triggerConnectionDetectionAction,
  updateConnectionAction,
  updateCurrentProjectAction,
} from './projectControllerMutationActions';
import {
  assertKnowledgeBaseReadAccess as assertKnowledgeBaseReadAccessSupport,
  assertKnowledgeBaseWriteAccess as assertKnowledgeBaseWriteAccessSupport,
  buildConnectionSettingsProperties as buildConnectionSettingsPropertiesSupport,
  buildBridgeRuntimeIdentity as buildBridgeRuntimeIdentitySupport,
  getActiveRuntimeProjectOrThrow as getActiveRuntimeProjectOrThrowSupport,
  getCurrentPersistedRuntimeIdentity as getCurrentPersistedRuntimeIdentitySupport,
  getCurrentRuntimeScopeId as getCurrentRuntimeScopeIdSupport,
  isManagedFederatedRuntimeProject as isManagedFederatedRuntimeProjectSupport,
  MANAGED_FEDERATED_RUNTIME_READONLY_MESSAGE,
  recordKnowledgeBaseReadAudit as recordKnowledgeBaseReadAuditSupport,
  recordKnowledgeBaseWriteAudit as recordKnowledgeBaseWriteAuditSupport,
  resolveActiveRuntimeKnowledgeBase as resolveActiveRuntimeKnowledgeBaseSupport,
  resolveActiveRuntimeProject as resolveActiveRuntimeProjectSupport,
  resolveKnowledgeBaseConnectionConnector as resolveKnowledgeBaseConnectionConnectorSupport,
  toAskRuntimeIdentity as toAskRuntimeIdentitySupport,
  upsertKnowledgeBaseConnectorForConnection as upsertKnowledgeBaseConnectorForConnectionSupport,
} from './projectControllerRuntimeSupport';
import { SchemaChangeType } from '@server/managers/connectionSchemaDetector';

export { MANAGED_FEDERATED_RUNTIME_READONLY_MESSAGE };

export class ProjectController {
  constructor() {
    this.getSettings = this.getSettings.bind(this);
    this.getProjectRecommendationQuestions =
      this.getProjectRecommendationQuestions.bind(this);
    this.updateCurrentProject = this.updateCurrentProject.bind(this);
    this.resetCurrentProject = this.resetCurrentProject.bind(this);
    this.saveConnection = this.saveConnection.bind(this);
    this.updateConnection = this.updateConnection.bind(this);
    this.listConnectionTables = this.listConnectionTables.bind(this);
    this.saveTables = this.saveTables.bind(this);
    this.autoGenerateRelation = this.autoGenerateRelation.bind(this);
    this.saveRelations = this.saveRelations.bind(this);
    this.getOnboardingStatus = this.getOnboardingStatus.bind(this);
    this.startSampleDataset = this.startSampleDataset.bind(this);
    this.triggerConnectionDetection =
      this.triggerConnectionDetection.bind(this);
    this.getSchemaChange = this.getSchemaChange.bind(this);
    this.createProjectFromConnection =
      this.createProjectFromConnection.bind(this);
    this.deploy = this.deploy.bind(this);
    this.ensureModelsBelongToActiveRuntime =
      this.ensureModelsBelongToActiveRuntime.bind(this);
    this.overwriteModelsAndColumns = this.overwriteModelsAndColumns.bind(this);
  }

  public getSettings({ ctx }: { ctx: IContext }) {
    return getSettingsAction({
      ctx,
      deps: {
        resolveActiveRuntimeProject: this.resolveActiveRuntimeProject,
        resolveActiveRuntimeKnowledgeBase:
          this.resolveActiveRuntimeKnowledgeBase,
        assertKnowledgeBaseReadAccess: this.assertKnowledgeBaseReadAccess,
        resolveKnowledgeBaseConnectionConnector:
          this.resolveKnowledgeBaseConnectionConnector,
        buildConnectionSettingsProperties:
          this.buildConnectionSettingsProperties,
        recordKnowledgeBaseReadAudit: this.recordKnowledgeBaseReadAudit,
      },
    });
  }

  public getProjectRecommendationQuestions(
    _root: any,
    _arg: any,
    ctx: IContext,
  ) {
    return getProjectRecommendationQuestionsAction({
      ctx,
      deps: {
        resolveActiveRuntimeProject: this.resolveActiveRuntimeProject,
        resolveActiveRuntimeKnowledgeBase:
          this.resolveActiveRuntimeKnowledgeBase,
        assertKnowledgeBaseReadAccess: this.assertKnowledgeBaseReadAccess,
        recordKnowledgeBaseReadAudit: this.recordKnowledgeBaseReadAudit,
      },
    });
  }

  public updateCurrentProject({
    language,
    ctx,
  }: {
    language: string;
    ctx: IContext;
  }) {
    return updateCurrentProjectAction({
      language,
      ctx,
      deps: {
        resolveActiveRuntimeKnowledgeBase:
          this.resolveActiveRuntimeKnowledgeBase,
        resolveActiveRuntimeProject: this.resolveActiveRuntimeProject,
        assertKnowledgeBaseWriteAccess: this.assertKnowledgeBaseWriteAccess,
        getCurrentRuntimeScopeId: this.getCurrentRuntimeScopeId,
        recordKnowledgeBaseWriteAudit: this.recordKnowledgeBaseWriteAudit,
      },
    });
  }

  public resetCurrentProject({ ctx }: { ctx: IContext }) {
    return resetCurrentProjectAction({
      ctx,
      deps: {
        resolveActiveRuntimeProject: this.resolveActiveRuntimeProject,
        resolveActiveRuntimeKnowledgeBase:
          this.resolveActiveRuntimeKnowledgeBase,
        assertKnowledgeBaseWriteAccess: this.assertKnowledgeBaseWriteAccess,
        getCurrentPersistedRuntimeIdentity:
          this.getCurrentPersistedRuntimeIdentity,
        toAskRuntimeIdentity: this.toAskRuntimeIdentity,
        recordKnowledgeBaseWriteAudit: this.recordKnowledgeBaseWriteAudit,
      },
    });
  }

  public saveConnection(_root: any, args: { data: DataSource }, ctx: IContext) {
    return saveConnectionAction({
      args,
      ctx,
      deps: {
        assertKnowledgeBaseWriteAccess: this.assertKnowledgeBaseWriteAccess,
        resolveActiveRuntimeKnowledgeBase:
          this.resolveActiveRuntimeKnowledgeBase,
        upsertKnowledgeBaseConnectorForConnection:
          this.upsertKnowledgeBaseConnectorForConnection,
        createProjectFromConnection: this.createProjectFromConnection,
        recordKnowledgeBaseWriteAudit: this.recordKnowledgeBaseWriteAudit,
      },
    });
  }

  public updateConnection(
    _root: any,
    args: { data: DataSource },
    ctx: IContext,
  ) {
    return updateConnectionAction({
      args,
      ctx,
      deps: {
        resolveActiveRuntimeKnowledgeBase:
          this.resolveActiveRuntimeKnowledgeBase,
        getActiveRuntimeProjectOrThrow: this.getActiveRuntimeProjectOrThrow,
        assertKnowledgeBaseWriteAccess: this.assertKnowledgeBaseWriteAccess,
        resolveKnowledgeBaseConnectionConnector:
          this.resolveKnowledgeBaseConnectionConnector,
        isManagedFederatedRuntimeProject: this.isManagedFederatedRuntimeProject,
        upsertKnowledgeBaseConnectorForConnection:
          this.upsertKnowledgeBaseConnectorForConnection,
        recordKnowledgeBaseWriteAudit: this.recordKnowledgeBaseWriteAudit,
        buildDuckDbEnvironment: buildDuckDbEnvironmentSupport,
      },
    });
  }

  public listConnectionTables({ ctx }: { ctx: IContext }) {
    return listConnectionTablesAction({
      ctx,
      deps: {
        resolveActiveRuntimeProject: this.resolveActiveRuntimeProject,
        resolveActiveRuntimeKnowledgeBase:
          this.resolveActiveRuntimeKnowledgeBase,
        assertKnowledgeBaseReadAccess: this.assertKnowledgeBaseReadAccess,
        recordKnowledgeBaseReadAudit: this.recordKnowledgeBaseReadAudit,
      },
    });
  }

  public saveTables(
    _root: any,
    args: { data: { tables: string[] } },
    ctx: IContext,
  ) {
    return saveTablesAction({
      args,
      ctx,
      deps: {
        getActiveRuntimeProjectOrThrow: this.getActiveRuntimeProjectOrThrow,
        assertKnowledgeBaseWriteAccess: this.assertKnowledgeBaseWriteAccess,
        overwriteModelsAndColumns: this.overwriteModelsAndColumns,
        deploy: this.deploy,
        recordKnowledgeBaseWriteAudit: this.recordKnowledgeBaseWriteAudit,
      },
    });
  }

  public autoGenerateRelation({ ctx }: { ctx: IContext }) {
    return autoGenerateRelationAction({
      ctx,
      deps: {
        resolveActiveRuntimeProject: this.resolveActiveRuntimeProject,
        resolveActiveRuntimeKnowledgeBase:
          this.resolveActiveRuntimeKnowledgeBase,
        assertKnowledgeBaseReadAccess: this.assertKnowledgeBaseReadAccess,
        recordKnowledgeBaseReadAudit: this.recordKnowledgeBaseReadAudit,
      },
    });
  }

  public saveRelations(
    _root: any,
    args: { data: { relations: RelationData[] } },
    ctx: IContext,
  ) {
    return saveRelationsAction({
      args,
      ctx,
      deps: {
        getActiveRuntimeProjectOrThrow: this.getActiveRuntimeProjectOrThrow,
        assertKnowledgeBaseWriteAccess: this.assertKnowledgeBaseWriteAccess,
        ensureModelsBelongToActiveRuntime:
          this.ensureModelsBelongToActiveRuntime,
        getCurrentPersistedRuntimeIdentity:
          this.getCurrentPersistedRuntimeIdentity,
        deploy: this.deploy,
        recordKnowledgeBaseWriteAudit: this.recordKnowledgeBaseWriteAudit,
      },
    });
  }

  public getOnboardingStatus({ ctx }: { ctx: IContext }) {
    return getOnboardingStatusAction({
      ctx,
      deps: {
        resolveActiveRuntimeProject: this.resolveActiveRuntimeProject,
        resolveActiveRuntimeKnowledgeBase:
          this.resolveActiveRuntimeKnowledgeBase,
        assertKnowledgeBaseReadAccess: this.assertKnowledgeBaseReadAccess,
        recordKnowledgeBaseReadAudit: this.recordKnowledgeBaseReadAudit,
      },
    });
  }

  public startSampleDataset(
    _root: any,
    args: { data: SampleDatasetData },
    ctx: IContext,
  ) {
    return startSampleDatasetAction({
      args,
      ctx,
      deps: {
        assertKnowledgeBaseWriteAccess: this.assertKnowledgeBaseWriteAccess,
        createProjectFromConnection: this.createProjectFromConnection,
        overwriteModelsAndColumns: this.overwriteModelsAndColumns,
        buildRelationInput: this.buildRelationInput,
        deploy: this.deploy,
        recordKnowledgeBaseWriteAudit: this.recordKnowledgeBaseWriteAudit,
      },
    });
  }

  public triggerConnectionDetection({ ctx }: { ctx: IContext }) {
    return triggerConnectionDetectionAction({
      ctx,
      deps: {
        getActiveRuntimeProjectOrThrow: this.getActiveRuntimeProjectOrThrow,
        assertKnowledgeBaseWriteAccess: this.assertKnowledgeBaseWriteAccess,
        recordKnowledgeBaseWriteAudit: this.recordKnowledgeBaseWriteAudit,
      },
    });
  }

  public resolveSchemaChange(type: SchemaChangeType, ctx: IContext) {
    return resolveSchemaChangeAction({
      type,
      ctx,
      deps: {
        getActiveRuntimeProjectOrThrow: this.getActiveRuntimeProjectOrThrow,
        assertKnowledgeBaseWriteAccess: this.assertKnowledgeBaseWriteAccess,
        recordKnowledgeBaseWriteAudit: this.recordKnowledgeBaseWriteAudit,
      },
    });
  }

  public getSchemaChange({ ctx }: { ctx: IContext }) {
    return getSchemaChangeAction({
      ctx,
      deps: {
        resolveActiveRuntimeProject: this.resolveActiveRuntimeProject,
        resolveActiveRuntimeKnowledgeBase:
          this.resolveActiveRuntimeKnowledgeBase,
        assertKnowledgeBaseReadAccess: this.assertKnowledgeBaseReadAccess,
        recordKnowledgeBaseReadAudit: this.recordKnowledgeBaseReadAudit,
      },
    });
  }

  private resolveActiveRuntimeProject(ctx: IContext) {
    return resolveActiveRuntimeProjectSupport(ctx);
  }

  private getActiveRuntimeProjectOrThrow(ctx: IContext) {
    return getActiveRuntimeProjectOrThrowSupport(ctx);
  }

  private resolveActiveRuntimeKnowledgeBase(ctx: IContext) {
    return resolveActiveRuntimeKnowledgeBaseSupport(ctx);
  }

  private getCurrentRuntimeScopeId(ctx: IContext) {
    return getCurrentRuntimeScopeIdSupport(ctx);
  }

  private getCurrentPersistedRuntimeIdentity(ctx: IContext) {
    return getCurrentPersistedRuntimeIdentitySupport(ctx);
  }

  private toAskRuntimeIdentity(runtimeIdentity: any) {
    return toAskRuntimeIdentitySupport(runtimeIdentity);
  }

  private assertKnowledgeBaseWriteAccess(ctx: IContext) {
    return assertKnowledgeBaseWriteAccessSupport(ctx);
  }

  private assertKnowledgeBaseReadAccess(ctx: IContext) {
    return assertKnowledgeBaseReadAccessSupport(ctx);
  }

  private resolveKnowledgeBaseConnectionConnector(
    ctx: IContext,
    knowledgeBase?: KnowledgeBase | null,
  ) {
    return resolveKnowledgeBaseConnectionConnectorSupport(ctx, knowledgeBase);
  }

  private upsertKnowledgeBaseConnectorForConnection(args: {
    ctx: IContext;
    knowledgeBase: KnowledgeBase;
    connection: DataSource;
    mode: 'save' | 'update';
  }) {
    return upsertKnowledgeBaseConnectorForConnectionSupport(args);
  }

  private createProjectFromConnection(connection: DataSource, ctx: IContext) {
    return createProjectFromConnectionSupport({
      connection,
      ctx,
      resetCurrentProject: this.resetCurrentProject,
      buildDuckDbEnvironment: buildDuckDbEnvironmentSupport,
      resolveActiveRuntimeKnowledgeBase: this.resolveActiveRuntimeKnowledgeBase,
    });
  }

  private deploy(ctx: IContext, project: Project) {
    return deployProjectSupport({
      ctx,
      project,
      buildBridgeRuntimeIdentity: this.buildBridgeRuntimeIdentity,
      getCurrentRuntimeScopeId: this.getCurrentRuntimeScopeId,
      resolveActiveRuntimeKnowledgeBase: this.resolveActiveRuntimeKnowledgeBase,
    });
  }

  private buildBridgeRuntimeIdentity(ctx: IContext, bridgeProjectId: number) {
    return buildBridgeRuntimeIdentitySupport(ctx, bridgeProjectId);
  }

  private buildConnectionSettingsProperties(args: {
    project: Project;
    knowledgeBase: KnowledgeBase | null;
    generalConnectionInfo: Record<string, any>;
  }) {
    return buildConnectionSettingsPropertiesSupport(args);
  }

  private isManagedFederatedRuntimeProject(
    project?: Project | null,
    knowledgeBase?: KnowledgeBase | null,
  ) {
    return isManagedFederatedRuntimeProjectSupport(project, knowledgeBase);
  }

  private recordKnowledgeBaseWriteAudit(
    ctx: IContext,
    args: {
      resourceType: string;
      resourceId?: string | number | null;
      afterJson?: Record<string, any> | null;
      payloadJson?: Record<string, any> | null;
    },
  ) {
    return recordKnowledgeBaseWriteAuditSupport(ctx, args);
  }

  private recordKnowledgeBaseReadAudit(
    ctx: IContext,
    args: {
      resourceType?: string | null;
      resourceId?: string | number | null;
      payloadJson?: Record<string, any> | null;
    },
  ) {
    return recordKnowledgeBaseReadAuditSupport(ctx, args);
  }

  private buildRelationInput(
    relations: any[],
    models: Model[],
    columns: ModelColumn[],
  ) {
    return buildRelationInputSupport(relations, models, columns);
  }

  private ensureModelsBelongToActiveRuntime(
    ctx: IContext,
    modelIds: number[],
    projectId: number,
  ) {
    return ensureModelsBelongToActiveRuntimeSupport({
      ctx,
      modelIds,
      projectId,
      getCurrentPersistedRuntimeIdentity:
        this.getCurrentPersistedRuntimeIdentity,
    });
  }

  private overwriteModelsAndColumns(
    tables: string[],
    ctx: IContext,
    project: Project,
  ) {
    return overwriteModelsAndColumnsSupport({
      tables,
      ctx,
      project,
      getCurrentPersistedRuntimeIdentity:
        this.getCurrentPersistedRuntimeIdentity,
    });
  }
}
