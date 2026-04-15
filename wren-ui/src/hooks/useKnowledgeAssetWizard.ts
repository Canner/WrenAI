import { useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';

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

export const resolveSelectedAssetSeed = ({
  connectors,
  demoTableOptions,
  isDemoSource,
  knowledgeOwner,
  selectedConnectorId,
  selectedDemoKnowledge,
  selectedDemoTable,
  wizardPreviewAssets,
}: {
  connectors: ConnectorLike[];
  demoTableOptions: DemoTableOption[];
  isDemoSource: boolean;
  knowledgeOwner?: string | null;
  selectedConnectorId?: string;
  selectedDemoKnowledge?: DemoKnowledgeLike | null;
  selectedDemoTable?: string;
  wizardPreviewAssets: AssetLike[];
}) => {
  if (isDemoSource && selectedDemoKnowledge) {
    const selectedTableLabel =
      demoTableOptions.find((option) => option.value === selectedDemoTable)
        ?.label || selectedDemoKnowledge.assetName;
    const selectedKind: 'model' | 'view' = selectedDemoTable?.includes(
      'core-fields',
    )
      ? 'model'
      : 'view';
    return {
      id: `${selectedDemoKnowledge.id}-${selectedDemoTable || 'theme-view'}`,
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
    };
  }

  if (selectedConnectorId) {
    const connector = connectors.find(
      (item) => item.id === selectedConnectorId,
    );
    if (!connector) {
      return null;
    }

    return {
      id: `connector-draft-${connector.id}`,
      name: `${connector.displayName} / 待引入资产`,
      description:
        '已选择真实数据库连接，下一步可先保存知识配置，再前往建模页完成字段与关系治理。',
      kind: 'model' as const,
      fieldCount: 4,
      owner: knowledgeOwner,
      sourceTableName: connector.displayName,
      sourceSql: null,
      primaryKey: 'id',
      cached: false,
      refreshTime: null,
      relationCount: 0,
      nestedFieldCount: 0,
      suggestedQuestions: [
        `围绕 ${connector.displayName} 设计适合业务分析的主题问法`,
        `请总结 ${connector.displayName} 的关键字段和建模建议`,
        `基于 ${connector.displayName} 规划下一步需要补齐的业务规则`,
      ],
      relationFields: [],
      fields: [
        {
          key: `${connector.id}-draft-id`,
          fieldName: 'id',
          fieldType: 'INTEGER',
          aiName: '主键',
          note: '连接器创建后可在建模页补齐真实字段映射',
          isPrimaryKey: true,
          isCalculated: false,
          aggregation: null,
          lineage: null,
          nestedFields: null,
        },
        {
          key: `${connector.id}-draft-name`,
          fieldName: 'name',
          fieldType: 'TEXT',
          aiName: '业务名称',
          isPrimaryKey: false,
          isCalculated: false,
          aggregation: null,
          lineage: null,
          nestedFields: null,
        },
        {
          key: `${connector.id}-draft-metric`,
          fieldName: 'metric_value',
          fieldType: 'FLOAT',
          aiName: '核心指标',
          isPrimaryKey: false,
          isCalculated: false,
          aggregation: null,
          lineage: null,
          nestedFields: null,
        },
        {
          key: `${connector.id}-draft-created-at`,
          fieldName: 'created_at',
          fieldType: 'TIMESTAMP',
          aiName: '创建时间',
          isPrimaryKey: false,
          isCalculated: false,
          aggregation: null,
          lineage: null,
          nestedFields: null,
        },
      ],
    };
  }

  if (wizardPreviewAssets.length > 0) {
    return wizardPreviewAssets[0];
  }

  return null;
};

export const resolveAssetDraftPreview = ({
  assetDraft,
  knowledgeOwner,
  selectedAssetSeed,
}: {
  assetDraft: AssetWizardDraft;
  knowledgeOwner?: string | null;
  selectedAssetSeed?: AssetLike | null;
}) => {
  if (!selectedAssetSeed) {
    return null;
  }

  return {
    ...selectedAssetSeed,
    name: assetDraft.name.trim() || selectedAssetSeed.name,
    description: assetDraft.description.trim() || selectedAssetSeed.description,
    owner: assetDraft.important
      ? `${knowledgeOwner || '工作区成员'} · 重点资产`
      : knowledgeOwner,
  };
};

export default function useKnowledgeAssetWizard({
  assetDraft,
  connectors,
  demoTableOptions,
  isDemoSource,
  knowledgeOwner,
  selectedConnectorId,
  selectedDemoKnowledge,
  selectedDemoTable,
  setAssetDraft,
  setAssetWizardStep,
  setDetailAsset,
  setDraftAssets,
  wizardPreviewAssets,
}: {
  assetDraft: AssetWizardDraft;
  connectors: ConnectorLike[];
  demoTableOptions: DemoTableOption[];
  isDemoSource: boolean;
  knowledgeOwner?: string | null;
  selectedConnectorId?: string;
  selectedDemoKnowledge?: DemoKnowledgeLike | null;
  selectedDemoTable?: string;
  setAssetDraft: Dispatch<SetStateAction<AssetWizardDraft>>;
  setAssetWizardStep: Dispatch<SetStateAction<number>>;
  setDetailAsset: Dispatch<SetStateAction<AssetLike | null>>;
  setDraftAssets: Dispatch<SetStateAction<AssetLike[]>>;
  wizardPreviewAssets: AssetLike[];
}) {
  const selectedAssetSeed = useMemo(
    () =>
      resolveSelectedAssetSeed({
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

  const assetDraftPreview = useMemo(
    () =>
      resolveAssetDraftPreview({
        assetDraft,
        knowledgeOwner,
        selectedAssetSeed,
      }),
    [assetDraft, knowledgeOwner, selectedAssetSeed],
  );

  const canContinueAssetConfiguration = Boolean(
    assetDraft.name.trim() && assetDraft.description.trim(),
  );

  const moveAssetWizardToConfig = useCallback(() => {
    if (!selectedAssetSeed) {
      return;
    }

    setAssetDraft({
      name: selectedAssetSeed.name,
      description:
        selectedAssetSeed.description ||
        '请补充该资产在当前知识库中的业务定位与关键口径。',
      important: true,
    });
    setAssetWizardStep(1);
  }, [selectedAssetSeed, setAssetDraft, setAssetWizardStep]);

  const saveAssetDraftToOverview = useCallback(() => {
    if (!assetDraftPreview) {
      return null;
    }

    const persistedAsset = {
      ...assetDraftPreview,
      id: `draft-asset-${Date.now()}`,
    };

    setDraftAssets((previous) => [
      persistedAsset,
      ...previous.filter((asset) => asset.name !== persistedAsset.name),
    ]);
    setDetailAsset(persistedAsset);
    setAssetWizardStep(2);
    return persistedAsset;
  }, [assetDraftPreview, setAssetWizardStep, setDetailAsset, setDraftAssets]);

  return {
    selectedAssetSeed,
    assetDraftPreview,
    canContinueAssetConfiguration,
    moveAssetWizardToConfig,
    saveAssetDraftToOverview,
  };
}
