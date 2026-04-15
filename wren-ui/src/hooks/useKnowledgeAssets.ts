import { useMemo } from 'react';
import type { DiagramQuery } from '@/apollo/client/graphql/diagram.generated';
import {
  getReferenceDisplayAssetDescription,
  getReferenceDisplayAssetName,
} from '@/utils/referenceDemoKnowledge';

type AssetField = {
  key: string;
  fieldName: string;
  fieldType?: string | null;
  aiName?: string | null;
  example?: string | null;
  enumValue?: string | null;
  note?: string | null;
  sourceColumnName?: string | null;
  isPrimaryKey?: boolean;
  isCalculated?: boolean;
  aggregation?: string | null;
  lineage?: number[] | null;
  nestedFields?: Array<{
    id: string;
    referenceName: string;
    displayName?: string | null;
    columnPath?: string[] | null;
    type?: string | null;
    description?: string | null;
  }> | null;
  relation?: {
    type?: string | null;
    modelName?: string | null;
    columnName?: string | null;
  } | null;
};

type AssetView = {
  id: string;
  name: string;
  description?: string | null;
  kind: 'model' | 'view';
  fieldCount: number;
  owner?: string | null;
  sourceTableName?: string | null;
  sourceSql?: string | null;
  primaryKey?: string | null;
  cached?: boolean;
  refreshTime?: string | null;
  relationCount?: number;
  nestedFieldCount?: number;
  suggestedQuestions?: string[];
  relationFields?: Array<{
    key: string;
    displayName: string;
    type?: string | null;
    modelName?: string | null;
    columnName?: string | null;
    note?: string | null;
  }>;
  fields: AssetField[];
};

type DemoKnowledgeLike = {
  id: string;
  assetName: string;
  description: string;
  fields: AssetField[];
  suggestedQuestions: string[];
};

export const resolveKnowledgePreviewFieldCount = ({
  totalFieldCount,
  demoFieldCount,
}: {
  totalFieldCount: number;
  demoFieldCount?: number;
}) => {
  if (totalFieldCount > 0) {
    return totalFieldCount;
  }

  return demoFieldCount || 0;
};

const buildAssetSuggestedQuestions = (
  assetName: string,
  fields: AssetField[],
  fallback?: string[],
) => {
  if (fallback?.length) {
    return fallback.slice(0, 3);
  }

  const topFields = fields
    .slice(0, 3)
    .map((field) => field.aiName || field.fieldName)
    .filter(Boolean);

  return [
    `请先概览 ${assetName} 的核心业务字段与可回答的问题`,
    topFields[0]
      ? `围绕 ${topFields[0]} 分析 ${assetName} 的总体趋势`
      : `基于 ${assetName} 做一份指标概览`,
    topFields[1]
      ? `结合 ${topFields[1]} 与 ${assetName} 给出异常或分层洞察`
      : `请给 ${assetName} 设计三条适合业务分析的问法`,
  ];
};

export default function useKnowledgeAssets({
  activeKnowledgeBaseName,
  hasActiveKnowledgeBase,
  activeKnowledgeBaseUsesRuntime,
  diagramData,
  draftAssets,
  knowledgeOwner,
  matchedDemoKnowledge,
}: {
  activeKnowledgeBaseName?: string | null;
  hasActiveKnowledgeBase: boolean;
  activeKnowledgeBaseUsesRuntime: boolean;
  diagramData: DiagramQuery | null;
  draftAssets: AssetView[];
  knowledgeOwner?: string | null;
  matchedDemoKnowledge?: DemoKnowledgeLike | null;
}) {
  const syncedAssets = useMemo<AssetView[]>(() => {
    if (!activeKnowledgeBaseUsesRuntime) {
      return [];
    }

    const fallbackSuggestedQuestions = matchedDemoKnowledge?.suggestedQuestions;
    const models = (diagramData?.diagram?.models || []).flatMap((model) => {
      if (!model) {
        return [];
      }

      const mappedFields: AssetField[] = [
        ...(model.fields || []).flatMap((field) =>
          field
            ? [
                {
                  key: `${model.id}-${field.id}`,
                  fieldName: field.referenceName,
                  fieldType: field.type,
                  aiName: field.displayName,
                  example: null,
                  note: field.description || null,
                  sourceColumnName: field.referenceName || null,
                  isPrimaryKey: Boolean(field.isPrimaryKey),
                  isCalculated: false,
                  aggregation: field.aggregation || null,
                  lineage: field.lineage || null,
                  nestedFields:
                    field.nestedFields?.map((nestedField) => ({
                      id: nestedField.id,
                      referenceName: nestedField.referenceName,
                      displayName: nestedField.displayName,
                      columnPath: nestedField.columnPath,
                      type: nestedField.type,
                      description: nestedField.description || null,
                    })) || null,
                },
              ]
            : [],
        ),
        ...(model.calculatedFields || []).flatMap((field) =>
          field
            ? [
                {
                  key: `${model.id}-${field.id}`,
                  fieldName: field.referenceName,
                  fieldType: field.type,
                  aiName: field.displayName,
                  example: null,
                  note: field.description || field.expression || null,
                  sourceColumnName: null,
                  isPrimaryKey: Boolean(field.isPrimaryKey),
                  isCalculated: true,
                  aggregation: field.aggregation || null,
                  lineage: field.lineage || null,
                  nestedFields:
                    field.nestedFields?.map((nestedField) => ({
                      id: nestedField.id,
                      referenceName: nestedField.referenceName,
                      displayName: nestedField.displayName,
                      columnPath: nestedField.columnPath,
                      type: nestedField.type,
                      description: nestedField.description || null,
                    })) || null,
                },
              ]
            : [],
        ),
      ];

      const relationFields =
        model.relationFields?.flatMap((field) =>
          field
            ? [
                {
                  key: `${model.id}-relation-${field.id}`,
                  displayName: field.displayName,
                  type: field.type,
                  modelName: field.toModelDisplayName || field.toModelName,
                  columnName: field.toColumnDisplayName || field.toColumnName,
                  note: field.description || null,
                },
              ]
            : [],
        ) || [];

      const nestedFieldCount = mappedFields.reduce(
        (sum, field) => sum + (field.nestedFields?.length || 0),
        0,
      );

      const assetName =
        model.displayName || model.referenceName || model.sourceTableName;
      return [
        {
          id: `model-${model.id}`,
          name: getReferenceDisplayAssetName(
            activeKnowledgeBaseName,
            assetName,
          ),
          description: getReferenceDisplayAssetDescription(
            activeKnowledgeBaseName,
            assetName,
            model.description || model.sourceTableName,
          ),
          kind: 'model' as const,
          fieldCount: mappedFields.length,
          owner: knowledgeOwner,
          sourceTableName: model.sourceTableName || null,
          sourceSql: model.refSql || null,
          primaryKey:
            mappedFields.find((field) => field.isPrimaryKey)?.fieldName || null,
          cached: Boolean(model.cached),
          refreshTime: model.refreshTime || null,
          relationCount: relationFields.length,
          nestedFieldCount,
          suggestedQuestions: buildAssetSuggestedQuestions(
            assetName,
            mappedFields,
            fallbackSuggestedQuestions,
          ),
          relationFields,
          fields: mappedFields,
        },
      ];
    });
    const views = (diagramData?.diagram?.views || []).flatMap((view) => {
      if (!view) {
        return [];
      }

      const mappedFields: AssetField[] = (view.fields || []).flatMap((field) =>
        field
          ? [
              {
                key: `${view.id}-${field.id}`,
                fieldName: field.referenceName,
                fieldType: field.type,
                aiName: field.displayName,
                example: null,
                note: field.description || null,
                sourceColumnName: field.referenceName || null,
                isPrimaryKey: false,
                isCalculated: false,
                aggregation: null,
                lineage: null,
                nestedFields: null,
              },
            ]
          : [],
      );

      const assetName = view.displayName || view.referenceName;
      return [
        {
          id: `view-${view.id}`,
          name: getReferenceDisplayAssetName(
            activeKnowledgeBaseName,
            assetName,
          ),
          description: getReferenceDisplayAssetDescription(
            activeKnowledgeBaseName,
            assetName,
            view.description || view.referenceName,
          ),
          kind: 'view' as const,
          fieldCount: mappedFields.length,
          owner: knowledgeOwner,
          sourceTableName: null,
          sourceSql: view.statement || null,
          primaryKey: null,
          cached: false,
          refreshTime: null,
          relationCount: 0,
          nestedFieldCount: 0,
          suggestedQuestions: buildAssetSuggestedQuestions(
            assetName,
            mappedFields,
            fallbackSuggestedQuestions,
          ),
          relationFields: [],
          fields: mappedFields,
        },
      ];
    });

    return [...models, ...views];
  }, [
    activeKnowledgeBaseName,
    activeKnowledgeBaseUsesRuntime,
    diagramData?.diagram?.models,
    diagramData?.diagram?.views,
    knowledgeOwner,
    matchedDemoKnowledge?.suggestedQuestions,
  ]);

  const assets = useMemo<AssetView[]>(
    () => [...draftAssets, ...syncedAssets],
    [draftAssets, syncedAssets],
  );

  const overviewPreviewAsset = useMemo<AssetView | null>(() => {
    if (!hasActiveKnowledgeBase || assets.length > 0 || !matchedDemoKnowledge) {
      return null;
    }

    return {
      id: `${matchedDemoKnowledge.id}-preview-asset`,
      name: matchedDemoKnowledge.assetName,
      description: matchedDemoKnowledge.description,
      kind: 'model',
      fieldCount: matchedDemoKnowledge.fields.length,
      owner: knowledgeOwner,
      sourceTableName: matchedDemoKnowledge.assetName,
      sourceSql: null,
      primaryKey: matchedDemoKnowledge.fields[0]?.fieldName || null,
      cached: false,
      refreshTime: null,
      relationCount: 0,
      nestedFieldCount: 0,
      suggestedQuestions: matchedDemoKnowledge.suggestedQuestions,
      relationFields: [],
      fields: matchedDemoKnowledge.fields,
    };
  }, [
    assets.length,
    hasActiveKnowledgeBase,
    knowledgeOwner,
    matchedDemoKnowledge,
  ]);

  const totalFieldCount = useMemo(
    () => assets.reduce((sum, asset) => sum + asset.fieldCount, 0),
    [assets],
  );
  const previewFieldCount = useMemo(
    () =>
      resolveKnowledgePreviewFieldCount({
        totalFieldCount,
        demoFieldCount: matchedDemoKnowledge?.fields.length,
      }),
    [matchedDemoKnowledge?.fields.length, totalFieldCount],
  );

  return {
    syncedAssets,
    assets,
    overviewPreviewAsset,
    totalFieldCount,
    previewFieldCount,
  };
}
