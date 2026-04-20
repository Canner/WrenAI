import {
  AppstoreOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { Button, Select, Space, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { KnowledgeAssetSelectOption } from '@/hooks/useKnowledgeAssetSelectOptions';
import { normalizeSelectedAssetTableValues } from '@/hooks/useKnowledgeAssetSource';
import {
  FieldCluster,
  LightButton,
  PurpleButton,
  RequiredMark,
  SectionTitle,
  SegmentedButton,
  SegmentedRow,
  SelectGrid,
  SourceCard,
  SourceCardMeta,
  SourceCardTitle,
  SourceGrid,
  WizardBody,
  WizardFooter,
  WizardNote,
} from '@/features/knowledgePage/index.styles';
import type {
  KnowledgeBaseRecord,
  SelectedAssetTableValue,
  SourceOption,
} from '@/features/knowledgePage/types';
import type { ReferenceDemoKnowledge } from '@/utils/referenceDemoKnowledge';
import AssetWizardTableSelector from './AssetWizardTableSelector';
import {
  buildAssetTableSelectorGroups,
  buildAssetTableSelectorItems,
  resolveAssetTableQuickFilters,
  resolveVisibleAssetTableSelectorItems,
} from './assetWizardSourceStepSupport';

const { Text } = Typography;

type AssetWizardSourceStepProps = {
  activeKnowledgeBase?: KnowledgeBaseRecord | null;
  assetDatabaseOptions: KnowledgeAssetSelectOption[];
  assetSourceSetupNote: string;
  assetSourceSummaryNote: string;
  assetTableOptions: KnowledgeAssetSelectOption[];
  canContinueAssetWizard: boolean;
  closeAssetModal: () => void;
  connectorsLoading: boolean;
  hasAvailableConnectorTargets: boolean;
  isDemoSource: boolean;
  knowledgeBases: KnowledgeBaseRecord[];
  moveAssetWizardToConfig: () => void;
  openConnectorConsole: () => Promise<unknown> | unknown;
  selectedConnectorId?: string;
  selectedDemoKnowledge?: ReferenceDemoKnowledge | null;
  selectedDemoTable?: SelectedAssetTableValue;
  selectedSourceType: string;
  setSelectedConnectorId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedDemoTable: Dispatch<
    SetStateAction<SelectedAssetTableValue | undefined>
  >;
  setSelectedSourceType: Dispatch<SetStateAction<string>>;
  sourceOptions: SourceOption[];
  visible: boolean;
};

export default function AssetWizardSourceStep({
  activeKnowledgeBase,
  assetDatabaseOptions,
  assetSourceSetupNote,
  assetSourceSummaryNote,
  assetTableOptions,
  canContinueAssetWizard,
  closeAssetModal,
  connectorsLoading,
  hasAvailableConnectorTargets,
  isDemoSource,
  knowledgeBases,
  moveAssetWizardToConfig,
  openConnectorConsole,
  selectedConnectorId,
  selectedDemoKnowledge,
  selectedDemoTable,
  selectedSourceType,
  setSelectedConnectorId,
  setSelectedDemoTable,
  setSelectedSourceType,
  sourceOptions,
  visible,
}: AssetWizardSourceStepProps) {
  const [hideImportedTables, setHideImportedTables] = useState(true);
  const [tablePrefixKeyword, setTablePrefixKeyword] = useState('');
  const [activeScopeLabel, setActiveScopeLabel] = useState('all');
  const selectedTableValues = useMemo(
    () => normalizeSelectedAssetTableValues(selectedDemoTable),
    [selectedDemoTable],
  );

  useEffect(() => {
    if (!visible) {
      setHideImportedTables(true);
      setTablePrefixKeyword('');
      setActiveScopeLabel('all');
    }
  }, [visible]);

  useEffect(() => {
    if (!isDemoSource) {
      setActiveScopeLabel('all');
      setTablePrefixKeyword('');
    }
  }, [isDemoSource, selectedConnectorId]);

  useEffect(() => {
    if (isDemoSource || selectedTableValues.length === 0) {
      return;
    }

    const nextSelectedValues = selectedTableValues.filter((value) => {
      const matchedOption = assetTableOptions.find(
        (option) => option.value === value,
      );
      return !matchedOption?.disabled;
    });

    if (nextSelectedValues.length === selectedTableValues.length) {
      return;
    }

    setSelectedDemoTable(
      nextSelectedValues.length > 0 ? nextSelectedValues : undefined,
    );
  }, [
    assetTableOptions,
    isDemoSource,
    selectedTableValues,
    setSelectedDemoTable,
  ]);

  const selectorItems = useMemo(
    () => buildAssetTableSelectorItems(assetTableOptions),
    [assetTableOptions],
  );
  const { prefixOptions, scopeOptions } = useMemo(
    () => resolveAssetTableQuickFilters(assetTableOptions),
    [assetTableOptions],
  );
  const importedCount = useMemo(
    () => selectorItems.filter((option) => option.imported).length,
    [selectorItems],
  );
  const availableCount = selectorItems.length - importedCount;
  const filteredAssetTableItems = useMemo(() => {
    if (isDemoSource) {
      return selectorItems;
    }

    return resolveVisibleAssetTableSelectorItems({
      activeScopeLabel,
      assetTableOptions,
      hideImportedTables,
      selectedTableValues,
      tablePrefixKeyword,
    });
  }, [
    assetTableOptions,
    activeScopeLabel,
    hideImportedTables,
    isDemoSource,
    selectedTableValues,
    selectorItems,
    tablePrefixKeyword,
  ]);
  const selectableFilteredValues = useMemo(
    () =>
      filteredAssetTableItems
        .filter((option) => !option.disabled)
        .map((option) => option.value),
    [filteredAssetTableItems],
  );
  const selectedTableItems = useMemo(() => {
    const itemMap = new Map(selectorItems.map((item) => [item.value, item]));
    return selectedTableValues
      .map((value) => itemMap.get(value))
      .filter((item): item is (typeof selectorItems)[number] => Boolean(item));
  }, [selectedTableValues, selectorItems]);
  const groupedAssetTableItems = useMemo(
    () => buildAssetTableSelectorGroups(filteredAssetTableItems),
    [filteredAssetTableItems],
  );

  const toggleSelectedTable = (value: string) => {
    setSelectedDemoTable((previous) => {
      const previousValues = normalizeSelectedAssetTableValues(previous);
      const nextValues = previousValues.includes(value)
        ? previousValues.filter((item) => item !== value)
        : [...previousValues, value];

      return nextValues.length > 0 ? nextValues : undefined;
    });
  };

  const selectAllFilteredTables = () => {
    setSelectedDemoTable((previous) =>
      Array.from(
        new Set([
          ...normalizeSelectedAssetTableValues(previous),
          ...selectableFilteredValues,
        ]),
      ),
    );
  };

  const toggleGroupSelection = (values: string[]) => {
    if (values.length === 0) {
      return;
    }

    setSelectedDemoTable((previous) => {
      const previousValues = normalizeSelectedAssetTableValues(previous);
      const previousValueSet = new Set(previousValues);
      const allSelected = values.every((value) => previousValueSet.has(value));

      if (allSelected) {
        const nextValues = previousValues.filter((value) => !values.includes(value));
        return nextValues.length > 0 ? nextValues : undefined;
      }

      return Array.from(new Set([...previousValues, ...values]));
    });
  };

  return (
    <WizardBody>
      <FieldCluster>
        <SectionTitle>
          <RequiredMark>*</RequiredMark>
          知识类型
        </SectionTitle>
        <SegmentedRow>
          <SegmentedButton type="button" $active>
            <DatabaseOutlined />
            表/数据集
          </SegmentedButton>
          <SegmentedButton
            type="button"
            $disabled
            disabled
            aria-disabled
            title="矩阵模型引入将在后续版本开放"
          >
            <AppstoreOutlined />
            矩阵模型
          </SegmentedButton>
        </SegmentedRow>
      </FieldCluster>

      <FieldCluster>
        <SectionTitle>
          <RequiredMark>*</RequiredMark>
          目标知识库
        </SectionTitle>
        <Select
          style={{ width: '100%' }}
          value={activeKnowledgeBase?.id}
          options={knowledgeBases.map((kb) => ({
            label: kb.name,
            value: kb.id,
          }))}
        />
      </FieldCluster>

      <SegmentedRow>
        <SegmentedButton type="button" $active>
          <PlusOutlined />
          单个/批量引入
        </SegmentedButton>
        <SegmentedButton type="button" $disabled disabled aria-disabled>
          <FolderOpenOutlined />
          支持多选数据表
        </SegmentedButton>
      </SegmentedRow>
      <Text type="secondary" style={{ fontSize: 12 }}>
        真实数据源支持一次选择多张表，可按 schema /
        表名前缀筛选，并自动跳过已导入资产。
      </Text>

      <FieldCluster>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <SectionTitle style={{ marginBottom: 0 }}>
            <RequiredMark>*</RequiredMark>
            来源
          </SectionTitle>
          <Button
            type="link"
            icon={<PlusOutlined />}
            onClick={() => void openConnectorConsole()}
          >
            管理数据连接器
          </Button>
        </div>
        <SourceGrid>
          {sourceOptions.map((option) => (
            <SourceCard
              key={option.key}
              type="button"
              $active={selectedSourceType === option.key}
              onClick={() => setSelectedSourceType(option.key)}
            >
              <SourceCardTitle>
                {option.icon}
                {option.label}
              </SourceCardTitle>
              <SourceCardMeta>{option.meta}</SourceCardMeta>
            </SourceCard>
          ))}
        </SourceGrid>
      </FieldCluster>

      {isDemoSource ? (
        <SelectGrid>
          <FieldCluster>
            <SectionTitle>
              <RequiredMark>*</RequiredMark>
              选择样例数据
            </SectionTitle>
            <Select
              style={{ width: '100%' }}
              placeholder="请选择样例数据"
              loading={connectorsLoading}
              value={selectedDemoKnowledge?.id}
              options={assetDatabaseOptions}
              disabled
            />
          </FieldCluster>
          <FieldCluster>
            <SectionTitle>
              <RequiredMark>*</RequiredMark>
              选择主题表
            </SectionTitle>
            <Select
              style={{ width: '100%' }}
              placeholder="请选择主题表"
              disabled={!selectedDemoKnowledge}
              value={selectedDemoTable}
              onChange={(value) => setSelectedDemoTable(value || undefined)}
              options={filteredAssetTableItems}
            />
          </FieldCluster>
        </SelectGrid>
      ) : (
        <>
          <FieldCluster>
            <SectionTitle>
              <RequiredMark>*</RequiredMark>
              选择数据库
            </SectionTitle>
            <Select
              style={{ width: '100%' }}
              placeholder="请选择数据库"
              loading={connectorsLoading}
              value={selectedConnectorId}
              onChange={(value) => setSelectedConnectorId(value)}
              options={assetDatabaseOptions}
            />
          </FieldCluster>
          <FieldCluster>
            <SectionTitle>
              <RequiredMark>*</RequiredMark>
              选择数据表
            </SectionTitle>
            <AssetWizardTableSelector
              activeScopeLabel={activeScopeLabel}
              assetTableCount={assetTableOptions.length}
              availableCount={availableCount}
              filteredAssetTableItems={filteredAssetTableItems}
              groupedAssetTableItems={groupedAssetTableItems}
              hideImportedTables={hideImportedTables}
              importedCount={importedCount}
              onClearSelected={() => setSelectedDemoTable(undefined)}
              onHideImportedTablesChange={setHideImportedTables}
              onPrefixSuggestionSelect={setTablePrefixKeyword}
              onSelectAllFiltered={selectAllFilteredTables}
              onScopeLabelChange={setActiveScopeLabel}
              onTablePrefixKeywordChange={setTablePrefixKeyword}
              onToggleGroupSelection={toggleGroupSelection}
              prefixOptions={prefixOptions}
              selectableFilteredValues={selectableFilteredValues}
              selectedConnectorId={selectedConnectorId}
              selectedCount={selectedTableValues.length}
              selectedTableItems={selectedTableItems}
              selectedTableValues={selectedTableValues}
              scopeOptions={scopeOptions}
              tablePrefixKeyword={tablePrefixKeyword}
              toggleSelectedTable={toggleSelectedTable}
            />
          </FieldCluster>
        </>
      )}

      <WizardNote>{assetSourceSetupNote}</WizardNote>

      <WizardFooter>
        <div>
          <Text type="secondary">{assetSourceSummaryNote}</Text>
          {!isDemoSource && !hasAvailableConnectorTargets && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                当前工作区还没有可导入的数据连接器，请先完成真实数据库接入。
              </Text>
            </div>
          )}
        </div>
        <Space size={12}>
          <LightButton onClick={closeAssetModal}>取消</LightButton>
          <PurpleButton
            onClick={moveAssetWizardToConfig}
            disabled={!canContinueAssetWizard}
          >
            下一步
          </PurpleButton>
        </Space>
      </WizardFooter>
    </WizardBody>
  );
}
