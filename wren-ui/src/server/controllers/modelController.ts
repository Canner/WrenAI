import {
  CreateCalculatedFieldData,
  CreateModelData,
  PreviewSQLData,
  UpdateCalculatedFieldData,
  UpdateModelData,
  UpdateModelMetadataInput,
  UpdateViewMetadataInput,
} from '../models';
import { IContext, RelationData, UpdateRelationData } from '../types';
import { DeployResponse } from '../services/deployService';
import {
  assertExecutableRuntimeScope,
  assertKnowledgeBaseReadAccess,
  assertKnowledgeBaseWriteAccess,
  buildPersistedRuntimeIdentityPayload,
  determineMetadataValue,
  ensureColumnScope,
  ensureModelScope,
  ensureModelsScope,
  ensureRelationScope,
  ensureViewScope,
  getCurrentRuntimeIdentity,
  getCurrentRuntimeScopeId,
  getResponseExecutionContext as getResponseExecutionContextSupport,
  getRuntimeProject,
  getRuntimeSelection,
  isInternalAiServicePreviewRequest,
  isInternalAiServiceRequest,
  recordKnowledgeBaseReadAudit,
  recordKnowledgeBaseWriteAudit,
  resolveBridgeProjectIdFallback,
  toExecutionRuntimeIdentitySource,
  validateColumnsExist,
  validateTableExist,
  validateViewName,
} from './modelControllerScopeSupport';
import {
  createCalculatedFieldAction,
  createRelationAction,
  deleteCalculatedFieldAction,
  deleteRelationAction,
  updateCalculatedFieldAction,
  updateRelationAction,
  validateCalculatedFieldAction,
} from './modelControllerRelationActions';
import {
  checkModelSyncAction,
  deployAction,
  getMDLAction,
} from './modelControllerRuntimeActions';
import {
  createModelAction,
  deleteModelAction,
  getModelAction,
  listModelsAction,
  updateModelAction,
} from './modelControllerModelActions';
import { updateModelMetadataAction } from './modelControllerModelMetadataActions';
import {
  createViewAction,
  deleteViewAction,
  getViewAction,
  listViewsAction,
  updateViewMetadataAction,
  validateViewAction,
} from './modelControllerViewActions';
import {
  getNativeSqlAction,
  previewModelDataAction,
  previewSqlAction,
  previewViewDataAction,
} from './modelControllerPreviewActions';

export { SyncStatusEnum } from './modelControllerShared';

const MODEL_CONTROLLER_DEPS = {
  assertExecutableRuntimeScope,
  assertKnowledgeBaseReadAccess,
  assertKnowledgeBaseWriteAccess,
  buildPersistedRuntimeIdentityPayload,
  determineMetadataValue,
  ensureColumnScope,
  ensureModelScope,
  ensureModelsScope,
  ensureRelationScope,
  ensureViewScope,
  getCurrentRuntimeIdentity,
  getCurrentRuntimeScopeId,
  getResponseExecutionContext: getResponseExecutionContextSupport,
  getRuntimeProject,
  getRuntimeSelection,
  isInternalAiServicePreviewRequest,
  isInternalAiServiceRequest,
  recordKnowledgeBaseReadAudit,
  recordKnowledgeBaseWriteAudit,
  resolveBridgeProjectIdFallback,
  toExecutionRuntimeIdentitySource,
  validateColumnsExist,
  validateTableExist,
  validateViewName,
};

export class ModelController {
  public createRelation({ data, ctx }: { data: RelationData; ctx: IContext }) {
    return createRelationAction({
      data,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public updateRelation({
    relationId,
    data,
    ctx,
  }: {
    relationId: number;
    data: UpdateRelationData;
    ctx: IContext;
  }) {
    return updateRelationAction({
      relationId,
      data,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public deleteRelation({
    relationId,
    ctx,
  }: {
    relationId: number;
    ctx: IContext;
  }) {
    return deleteRelationAction({
      relationId,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public createCalculatedField({
    data,
    ctx,
  }: {
    data: CreateCalculatedFieldData;
    ctx: IContext;
  }) {
    return createCalculatedFieldAction({
      data,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public validateCalculatedField({
    name,
    modelId,
    columnId,
    ctx,
  }: {
    name: string;
    modelId: number;
    columnId?: number;
    ctx: IContext;
  }) {
    return validateCalculatedFieldAction({
      name,
      modelId,
      columnId,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public updateCalculatedField({
    columnId,
    data,
    ctx,
  }: {
    columnId: number;
    data: UpdateCalculatedFieldData;
    ctx: IContext;
  }) {
    return updateCalculatedFieldAction({
      columnId,
      data,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public deleteCalculatedField({
    columnId,
    ctx,
  }: {
    columnId: number;
    ctx: IContext;
  }) {
    return deleteCalculatedFieldAction({
      columnId,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public checkModelSync({ ctx }: { ctx: IContext }) {
    return checkModelSyncAction({
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public deploy({
    force,
    ctx,
    allowInternalBypass = false,
  }: {
    force: boolean;
    ctx: IContext;
    allowInternalBypass?: boolean;
  }): Promise<DeployResponse> {
    return deployAction({
      force,
      ctx,
      allowInternalBypass,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public getMDL({ hash, ctx }: { hash: string; ctx: IContext }) {
    return getMDLAction({
      hash,
      ctx,
      deps: { assertKnowledgeBaseReadAccess, recordKnowledgeBaseReadAudit },
    });
  }

  public listModels({ ctx }: { ctx: IContext }) {
    return listModelsAction({
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public getModel({ modelId, ctx }: { modelId: number; ctx: IContext }) {
    return getModelAction({
      modelId,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public createModel({ data, ctx }: { data: CreateModelData; ctx: IContext }) {
    return createModelAction({
      data,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public updateModel({
    modelId,
    data,
    ctx,
  }: {
    modelId: number;
    data: UpdateModelData;
    ctx: IContext;
  }) {
    return updateModelAction({
      modelId,
      data,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public deleteModel({ modelId, ctx }: { modelId: number; ctx: IContext }) {
    return deleteModelAction({
      modelId,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public updateModelMetadata({
    modelId,
    data,
    ctx,
  }: {
    modelId: number;
    data: UpdateModelMetadataInput;
    ctx: IContext;
  }): Promise<boolean> {
    return updateModelMetadataAction({
      modelId,
      data,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public listViews({ ctx }: { ctx: IContext }) {
    return listViewsAction({
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public getView({ viewId, ctx }: { viewId: number; ctx: IContext }) {
    return getViewAction({
      viewId,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public validateView({ name, ctx }: { name: string; ctx: IContext }) {
    return validateViewAction({
      name,
      ctx,
      deps: { assertKnowledgeBaseWriteAccess, validateViewName },
    });
  }

  public createView({
    name,
    responseId,
    rephrasedQuestion,
    ctx,
  }: {
    name: string;
    responseId: number;
    rephrasedQuestion?: string | null;
    ctx: IContext;
  }) {
    return createViewAction({
      name,
      responseId,
      rephrasedQuestion,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public deleteView({ viewId, ctx }: { viewId: number; ctx: IContext }) {
    return deleteViewAction({
      viewId,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public previewModelData({
    modelId,
    ctx,
  }: {
    modelId: number;
    ctx: IContext;
  }) {
    return previewModelDataAction({
      modelId,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public previewViewData({
    viewId,
    limit,
    ctx,
  }: {
    viewId: number;
    limit?: number;
    ctx: IContext;
  }) {
    return previewViewDataAction({
      viewId,
      limit,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public previewSql({ data, ctx }: { data: PreviewSQLData; ctx: IContext }) {
    return previewSqlAction({
      data,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public getNativeSql({
    responseId,
    ctx,
  }: {
    responseId: number;
    ctx: IContext;
  }): Promise<string> {
    return getNativeSqlAction({
      responseId,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  public updateViewMetadata({
    viewId,
    data,
    ctx,
  }: {
    viewId: number;
    data: UpdateViewMetadataInput;
    ctx: IContext;
  }): Promise<boolean> {
    return updateViewMetadataAction({
      viewId,
      data,
      ctx,
      deps: MODEL_CONTROLLER_DEPS,
    });
  }

  private getResponseExecutionContext(
    ctx: IContext,
    source?: Record<string, any> | null,
  ) {
    return getResponseExecutionContextSupport(ctx, source);
  }
}
