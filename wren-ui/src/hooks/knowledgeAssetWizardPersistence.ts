import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import type { DiagramModelRecommendation } from '@/types/modeling';
import type { UpdateModelMetadataInput } from '@/types/modeling';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import {
  createModel,
  deployCurrentRuntime,
  updateModelMetadata,
} from '@/utils/modelingRest';
import { parseRestJsonResponse } from '@/utils/rest';

type PersistableAssetField = {
  fieldName: string;
  isCalculated?: boolean;
};

type PersistableAsset = {
  name: string;
  description?: string | null;
  primaryKey?: string | null;
  sourceTableName?: string | null;
  connectorTableName?: string | null;
  fields: PersistableAssetField[];
};

type PersistedConnectorAsset<TAsset extends PersistableAsset> = TAsset & {
  modelId: number;
  recommendation: DiagramModelRecommendation;
  suggestedQuestions: string[];
};

type PersistConnectorAssetDraftsResult<TAsset extends PersistableAsset> = {
  persistedAssets: PersistedConnectorAsset<TAsset>[];
  runtimeSelector: ClientRuntimeScopeSelector;
};

export const resolvePersistableConnectorTableName = (
  asset: PersistableAsset,
) => {
  const persistedTableName =
    asset.connectorTableName?.trim() || asset.sourceTableName?.trim() || '';

  if (!persistedTableName) {
    throw new Error('缺少可持久化的数据表标识，请重新选择数据表。');
  }

  return persistedTableName;
};

export const resolvePersistableConnectorFieldNames = (
  asset: PersistableAsset,
) => {
  const fields = asset.fields
    .filter((field) => !field.isCalculated)
    .map((field) => field.fieldName?.trim())
    .filter((field): field is string => Boolean(field));

  return Array.from(new Set(fields));
};

export const buildModelMetadataPayload = (
  asset: PersistableAsset,
): UpdateModelMetadataInput => ({
  displayName: asset.name,
  description: asset.description || '',
  columns: [],
  nestedColumns: [],
  calculatedFields: [],
  relationships: [],
});

type ConnectorRuntimeActivationPayload = {
  connectorId: string;
  projectId: number;
  selector: ClientRuntimeScopeSelector;
};

export const activateKnowledgeConnectorRuntime = async (
  selector: ClientRuntimeScopeSelector,
  connectorId: string,
) => {
  const response = await fetch(
    buildRuntimeScopeUrl(
      `/api/v1/connectors/${connectorId}/activate`,
      {},
      selector,
    ),
    {
      method: 'POST',
    },
  );

  return parseRestJsonResponse<ConnectorRuntimeActivationPayload>(
    response,
    '激活知识库数据连接失败，请稍后重试。',
  );
};

export const persistConnectorAssetDrafts = async <
  TAsset extends PersistableAsset,
>({
  assetDraftPreviews,
  connectorId,
  selector,
}: {
  assetDraftPreviews: TAsset[];
  connectorId?: string | null;
  selector: ClientRuntimeScopeSelector;
}): Promise<PersistConnectorAssetDraftsResult<TAsset>> => {
  const persistedAssets: PersistedConnectorAsset<TAsset>[] = [];
  let effectiveSelector = selector;

  if (connectorId) {
    const activation = await activateKnowledgeConnectorRuntime(
      selector,
      connectorId,
    );
    if (activation?.selector) {
      effectiveSelector = activation.selector;
    }
  }

  for (const preview of assetDraftPreviews) {
    const sourceTableName = resolvePersistableConnectorTableName(preview);
    const fields = resolvePersistableConnectorFieldNames(preview);
    const primaryKey = preview.primaryKey?.trim() || fields[0];

    if (!fields.length || !primaryKey) {
      throw new Error(`资产 ${preview.name} 缺少可导入字段或主键信息。`);
    }

    const createdModel = await createModel(effectiveSelector, {
      connectorId: connectorId || null,
      fields,
      primaryKey,
      sourceTableName,
    });
    const modelId = Number(createdModel?.id);

    if (!Number.isFinite(modelId) || modelId <= 0) {
      throw new Error(`资产 ${preview.name} 创建成功但未返回有效模型 ID。`);
    }

    await updateModelMetadata(
      effectiveSelector,
      modelId,
      buildModelMetadataPayload(preview),
    );

    persistedAssets.push({
      ...preview,
      modelId,
      recommendation: {
        error: null,
        queryId: null,
        questions: [],
        status: 'NOT_STARTED',
        updatedAt: null,
      },
      suggestedQuestions: [],
    });
  }

  const deployResult = await deployCurrentRuntime(effectiveSelector);
  if (deployResult?.status === 'FAILED') {
    throw new Error(
      deployResult.error || '资产已保存，但同步知识库运行时失败，请稍后重试。',
    );
  }

  return {
    persistedAssets,
    runtimeSelector: deployResult?.selector || effectiveSelector,
  };
};
