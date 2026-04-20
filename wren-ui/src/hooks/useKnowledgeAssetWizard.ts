import { useCallback, useMemo } from 'react';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import type { Dispatch, SetStateAction } from 'react';
import type { SelectedAssetTableValue } from '@/features/knowledgePage/types';
import type { CompactTable } from '@/types/dataSource';
import {
  getCompactTableQualifiedName,
  getCompactTableScopedName,
} from '@/utils/compactTable';
import { normalizeSelectedAssetTableValues } from './useKnowledgeAssetSource';
import { persistConnectorAssetDrafts } from './knowledgeAssetWizardPersistence';

type AssetField = {
  key: string;
  fieldName: string;
  fieldType?: string | null;
  aiName?: string | null;
  note?: string | null;
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
};

type AssetLike = {
  id: string;
  name: string;
  description?: string | null;
  kind: 'model' | 'view';
  fieldCount: number;
  owner?: string | null;
  sourceTableName?: string | null;
  sourceSql?: string | null;
  primaryKey?: string | null;
  connectorTableName?: string | null;
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
  name: string;
  description: string;
  assetName: string;
  owner: string;
  fields: AssetField[];
  suggestedQuestions: string[];
};

type ConnectorLike = {
  id: string;
  displayName: string;
  type: string;
};

type ConnectorTableLike = CompactTable;

type DemoTableOption = {
  label: string;
  value: string;
};

export type AssetWizardDraft = {
  name: string;
  description: string;
  important: boolean;
};

export const resolveWizardPreviewAssets = ({
  assets,
  selectedDemoKnowledge,
}: {
  assets: AssetLike[];
  selectedDemoKnowledge?: DemoKnowledgeLike | null;
}) => {
  if (assets.length > 0) {
    return assets;
  }

  if (!selectedDemoKnowledge) {
    return [];
  }

  return [
    {
      id: `${selectedDemoKnowledge.id}-wizard-preview`,
      name: selectedDemoKnowledge.assetName,
      description: selectedDemoKnowledge.description,
      kind: 'view' as const,
      fieldCount: selectedDemoKnowledge.fields.length,
      owner: selectedDemoKnowledge.owner,
      sourceTableName: selectedDemoKnowledge.assetName,
      sourceSql: null,
      primaryKey: selectedDemoKnowledge.fields[0]?.fieldName || null,
      cached: false,
      refreshTime: null,
      relationCount: 0,
      nestedFieldCount: 0,
      suggestedQuestions: selectedDemoKnowledge.suggestedQuestions,
      relationFields: [],
      fields: selectedDemoKnowledge.fields,
    },
  ];
};

export const resolveSelectedAssetSeeds = ({
  connectorTables,
  connectors,
  demoTableOptions,
  isDemoSource,
  knowledgeOwner,
  selectedConnectorId,
  selectedDemoKnowledge,
  selectedDemoTable,
  wizardPreviewAssets,
}: {
  connectorTables: ConnectorTableLike[];
  connectors: ConnectorLike[];
  demoTableOptions: DemoTableOption[];
  isDemoSource: boolean;
  knowledgeOwner?: string | null;
  selectedConnectorId?: string;
  selectedDemoKnowledge?: DemoKnowledgeLike | null;
  selectedDemoTable?: SelectedAssetTableValue;
  wizardPreviewAssets: AssetLike[];
}) => {
  const selectedTableValues =
    normalizeSelectedAssetTableValues(selectedDemoTable);

  if (isDemoSource && selectedDemoKnowledge) {
    const selectedDemoTableValue =
      selectedTableValues[0] || `${selectedDemoKnowledge.id}::theme-view`;
    const selectedTableLabel =
      demoTableOptions.find((option) => option.value === selectedDemoTableValue)
        ?.label || selectedDemoKnowledge.assetName;
    const selectedKind: 'model' | 'view' = selectedDemoTableValue.includes(
      'core-fields',
    )
      ? 'model'
      : 'view';
    return [
      {
        id: `${selectedDemoKnowledge.id}-${selectedDemoTableValue}`,
        name: selectedTableLabel,
        description: selectedDemoKnowledge.description,
        kind: selectedKind,
        fieldCount: selectedDemoKnowledge.fields.length,
        owner: selectedDemoKnowledge.owner,
        sourceTableName: selectedTableLabel,
        sourceSql: null,
        primaryKey: selectedDemoKnowledge.fields[0]?.fieldName || null,
        cached: false,
        refreshTime: null,
        relationCount: 0,
        nestedFieldCount: 0,
        suggestedQuestions: selectedDemoKnowledge.suggestedQuestions,
        relationFields: [],
        fields: selectedDemoKnowledge.fields,
      },
    ];
  }

  if (selectedConnectorId) {
    const connector = connectors.find(
      (item) => item.id === selectedConnectorId,
    );
    if (!connector || selectedTableValues.length === 0) {
      return [];
    }

    return selectedTableValues
      .map((tableValue) => {
        const selectedTable = connectorTables.find(
          (table) => getCompactTableQualifiedName(table) === tableValue,
        );
        if (!selectedTable) {
          return null;
        }

        const tableDisplayName = getCompactTableScopedName(selectedTable);
        const tableQualifiedName = getCompactTableQualifiedName(selectedTable);
        const fields = selectedTable.columns.map((column, index) => ({
          key: `${connector.id}-${tableQualifiedName}-${column.name}-${index}`,
          fieldName: column.name,
          fieldType: column.type || null,
          aiName: column.name,
          note: null,
          isPrimaryKey:
            selectedTable.primaryKey != null
              ? selectedTable.primaryKey === column.name
              : index === 0,
          isCalculated: false,
          aggregation: null,
          lineage: null,
          nestedFields: null,
        }));

        return {
          id: `connector-draft-${connector.id}-${tableQualifiedName}`,
          name: tableDisplayName,
          description: `来自 ${connector.displayName} 的真实数据表，可继续补充知识配置后进入建模。`,
          kind: 'model' as const,
          fieldCount: fields.length,
          owner: knowledgeOwner,
          sourceTableName: tableQualifiedName,
          connectorTableName: selectedTable.name || tableQualifiedName,
          sourceSql: null,
          primaryKey: selectedTable.primaryKey || fields[0]?.fieldName || null,
          cached: false,
          refreshTime: null,
          relationCount: 0,
          nestedFieldCount: 0,
          suggestedQuestions: [
            `围绕 ${tableDisplayName} 设计适合业务分析的主题问法`,
            `请总结 ${tableDisplayName} 的关键字段和建模建议`,
            `基于 ${tableDisplayName} 规划下一步需要补齐的业务规则`,
          ],
          relationFields: [],
          fields,
        };
      })
      .filter(Boolean) as AssetLike[];
  }

  if (wizardPreviewAssets.length > 0) {
    return [wizardPreviewAssets[0]];
  }

  return [];
};

export const resolveSelectedAssetSeed = (
  args: Parameters<typeof resolveSelectedAssetSeeds>[0],
) => resolveSelectedAssetSeeds(args)[0] || null;

export const resolveAssetDraftPreviews = ({
  assetDraft,
  knowledgeOwner,
  selectedAssetSeeds,
}: {
  assetDraft: AssetWizardDraft;
  knowledgeOwner?: string | null;
  selectedAssetSeeds: AssetLike[];
}) => {
  const trimmedName = assetDraft.name.trim();
  const trimmedDescription = assetDraft.description.trim();
  const isBatchSelection = selectedAssetSeeds.length > 1;

  return selectedAssetSeeds.map((selectedAssetSeed) => ({
    ...selectedAssetSeed,
    name: isBatchSelection
      ? trimmedName
        ? `${trimmedName}${selectedAssetSeed.name}`
        : selectedAssetSeed.name
      : trimmedName || selectedAssetSeed.name,
    description: trimmedDescription || selectedAssetSeed.description,
    owner: assetDraft.important
      ? `${knowledgeOwner || '工作区成员'} · 重点资产`
      : knowledgeOwner,
  }));
};

export const resolveAssetDraftPreview = ({
  assetDraft,
  knowledgeOwner,
  selectedAssetSeed,
}: {
  assetDraft: AssetWizardDraft;
  knowledgeOwner?: string | null;
  selectedAssetSeed?: AssetLike | null;
}) =>
  resolveAssetDraftPreviews({
    assetDraft,
    knowledgeOwner,
    selectedAssetSeeds: selectedAssetSeed ? [selectedAssetSeed] : [],
  })[0] || null;

export default function useKnowledgeAssetWizard({
  assetDraft,
  connectorTables,
  connectors,
  demoTableOptions,
  isDemoSource,
  knowledgeOwner,
  selectedConnectorId,
  selectedDemoKnowledge,
  selectedDemoTable,
  activeKnowledgeRuntimeSelector,
  refetchDiagram,
  refetchRuntimeSelector,
  replaceRuntimeScope,
  setAssetDraft,
  setAssetWizardStep,
  setDetailAsset,
  setDraftAssets,
  wizardPreviewAssets,
}: {
  assetDraft: AssetWizardDraft;
  connectorTables: ConnectorTableLike[];
  connectors: ConnectorLike[];
  demoTableOptions: DemoTableOption[];
  isDemoSource: boolean;
  knowledgeOwner?: string | null;
  selectedConnectorId?: string;
  selectedDemoKnowledge?: DemoKnowledgeLike | null;
  selectedDemoTable?: SelectedAssetTableValue;
  activeKnowledgeRuntimeSelector?: ClientRuntimeScopeSelector | null;
  refetchDiagram?: () => Promise<unknown>;
  refetchRuntimeSelector?: () => Promise<unknown>;
  replaceRuntimeScope?: (
    selector: ClientRuntimeScopeSelector,
  ) => Promise<unknown>;
  setAssetDraft: Dispatch<SetStateAction<AssetWizardDraft>>;
  setAssetWizardStep: Dispatch<SetStateAction<number>>;
  setDetailAsset: Dispatch<SetStateAction<AssetLike | null>>;
  setDraftAssets: Dispatch<SetStateAction<AssetLike[]>>;
  wizardPreviewAssets: AssetLike[];
}) {
  const selectedAssetSeeds = useMemo(
    () =>
      resolveSelectedAssetSeeds({
        connectorTables,
        connectors,
        demoTableOptions,
        isDemoSource,
        knowledgeOwner,
        selectedConnectorId,
        selectedDemoKnowledge,
        selectedDemoTable,
        wizardPreviewAssets,
      }),
    [
      connectorTables,
      connectors,
      demoTableOptions,
      isDemoSource,
      knowledgeOwner,
      selectedConnectorId,
      selectedDemoKnowledge,
      selectedDemoTable,
      wizardPreviewAssets,
    ],
  );

  const assetDraftPreviews = useMemo(
    () =>
      resolveAssetDraftPreviews({
        assetDraft,
        knowledgeOwner,
        selectedAssetSeeds,
      }),
    [assetDraft, knowledgeOwner, selectedAssetSeeds],
  );

  const assetDraftPreview = assetDraftPreviews[0] || null;

  const requiresAssetName = selectedAssetSeeds.length <= 1;
  const canContinueAssetConfiguration = Boolean(
    assetDraft.description.trim() &&
      (!requiresAssetName || assetDraft.name.trim()),
  );

  const moveAssetWizardToConfig = useCallback(() => {
    if (selectedAssetSeeds.length === 0) {
      return;
    }

    const primaryAssetSeed = selectedAssetSeeds[0];
    const selectedConnector = connectors.find(
      (connector) => connector.id === selectedConnectorId,
    );
    const batchDescription =
      selectedAssetSeeds.length > 1
        ? `来自 ${selectedConnector?.displayName || '当前连接器'} 的 ${
            selectedAssetSeeds.length
          } 张真实数据表，可继续补充统一知识配置后进入建模。`
        : null;

    setAssetDraft({
      name: selectedAssetSeeds.length > 1 ? '' : primaryAssetSeed.name,
      description:
        batchDescription ||
        primaryAssetSeed.description ||
        '请补充该资产在当前知识库中的业务定位与关键口径。',
      important: true,
    });
    setAssetWizardStep(1);
  }, [
    connectors,
    selectedAssetSeeds,
    selectedConnectorId,
    setAssetDraft,
    setAssetWizardStep,
  ]);

  const saveAssetDraftToOverview = useCallback(async () => {
    if (assetDraftPreviews.length === 0) {
      return null;
    }

    if (!isDemoSource) {
      if (!activeKnowledgeRuntimeSelector?.knowledgeBaseId || !refetchDiagram) {
        throw new Error('当前知识库运行上下文未就绪，请稍后重试。');
      }

      const persistedAssets = await persistConnectorAssetDrafts({
        assetDraftPreviews,
        connectorId: selectedConnectorId || null,
        refetchDiagram,
        refetchRuntimeSelector,
        replaceRuntimeScope,
        selector: activeKnowledgeRuntimeSelector,
      });
      const persistedKeys = new Set(
        persistedAssets.map(
          (asset) =>
            asset.sourceTableName || asset.connectorTableName || asset.name,
        ),
      );

      setDraftAssets((previous) =>
        previous.filter(
          (asset) => !persistedKeys.has(asset.sourceTableName || asset.name),
        ),
      );
      setDetailAsset(null);
      setAssetWizardStep(2);
      return persistedAssets[0] || null;
    }

    const createdAt = Date.now();
    const persistedAssets = assetDraftPreviews.map((preview, index) => ({
      ...preview,
      id: `draft-asset-${createdAt}-${index}`,
    }));
    const persistedAsset = persistedAssets[0];
    const persistedKeys = new Set(
      persistedAssets.map(
        (asset) =>
          asset.sourceTableName || asset.connectorTableName || asset.name,
      ),
    );

    setDraftAssets((previous) => [
      ...persistedAssets,
      ...previous.filter(
        (asset) => !persistedKeys.has(asset.sourceTableName || asset.name),
      ),
    ]);
    setDetailAsset(persistedAsset);
    setAssetWizardStep(2);
    return persistedAsset;
  }, [
    activeKnowledgeRuntimeSelector,
    assetDraftPreviews,
    isDemoSource,
    refetchDiagram,
    refetchRuntimeSelector,
    replaceRuntimeScope,
    selectedConnectorId,
    setAssetWizardStep,
    setDetailAsset,
    setDraftAssets,
  ]);

  return {
    selectedAssetSeed: selectedAssetSeeds[0] || null,
    selectedAssetSeeds,
    assetDraftPreview,
    assetDraftPreviews,
    canContinueAssetConfiguration,
    moveAssetWizardToConfig,
    saveAssetDraftToOverview,
  };
}
