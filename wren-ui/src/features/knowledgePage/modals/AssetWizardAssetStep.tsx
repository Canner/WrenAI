import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Space, Typography } from 'antd';
import type { KnowledgeAssetSelectOption } from '@/hooks/useKnowledgeAssetSelectOptions';
import { normalizeSelectedAssetTableValues } from '@/hooks/useKnowledgeAssetSource';
import type { SelectedAssetTableValue } from '@/features/knowledgePage/types';
import {
  FieldCluster,
  LightButton,
  PurpleButton,
  RequiredMark,
  SectionTitle,
  WizardBody,
  WizardFooter,
  WizardNote,
} from '@/features/knowledgePage/index.styles';
import type { ReferenceDemoKnowledge } from '@/utils/referenceDemoKnowledge';
import AssetWizardTableSelector from './AssetWizardTableSelector';
import {
  buildAssetTableSelectorGroups,
  buildAssetTableSelectorItems,
  resolveAssetTableQuickFilters,
  resolveVisibleAssetTableSelectorItems,
} from './assetWizardSourceStepSupport';

const { Text } = Typography;

type AssetWizardAssetStepProps = {
  assetDatabaseOptions: KnowledgeAssetSelectOption[];
  assetTableOptions: KnowledgeAssetSelectOption[];
  canContinueAssetWizard: boolean;
  closeAssetModal: () => void;
  isDemoSource: boolean;
  moveAssetWizardToConfig: () => void;
  onBack: () => void;
  selectedConnectorId?: string;
  selectedDemoKnowledge?: ReferenceDemoKnowledge | null;
  selectedDemoTable?: SelectedAssetTableValue;
  setSelectedDemoTable: Dispatch<
    SetStateAction<SelectedAssetTableValue | undefined>
  >;
  visible: boolean;
};

export default function AssetWizardAssetStep({
  assetDatabaseOptions,
  assetTableOptions,
  canContinueAssetWizard,
  closeAssetModal,
  isDemoSource,
  moveAssetWizardToConfig,
  onBack,
  selectedConnectorId,
  selectedDemoKnowledge,
  selectedDemoTable,
  setSelectedDemoTable,
  visible,
}: AssetWizardAssetStepProps) {
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
  const lockedSelectedTableItems = useMemo(
    () => selectorItems.filter((item) => item.imported),
    [selectorItems],
  );
  const lockedSelectedTableValues = useMemo(
    () => lockedSelectedTableItems.map((item) => item.value),
    [lockedSelectedTableItems],
  );
  const displaySelectedTableValues = useMemo(
    () =>
      Array.from(
        new Set([...lockedSelectedTableValues, ...selectedTableValues]),
      ),
    [lockedSelectedTableValues, selectedTableValues],
  );
  const filteredAssetTableItems = useMemo(() => {
    if (isDemoSource) {
      return selectorItems;
    }

    return resolveVisibleAssetTableSelectorItems({
      activeScopeLabel,
      assetTableOptions,
      hideImportedTables,
      selectedTableValues: displaySelectedTableValues,
      tablePrefixKeyword,
    });
  }, [
    assetTableOptions,
    activeScopeLabel,
    displaySelectedTableValues,
    hideImportedTables,
    isDemoSource,
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
        const nextValues = previousValues.filter(
          (value) => !values.includes(value),
        );
        return nextValues.length > 0 ? nextValues : undefined;
      }

      return Array.from(new Set([...previousValues, ...values]));
    });
  };

  const selectedConnectorLabel =
    assetDatabaseOptions.find((option) => option.value === selectedConnectorId)
      ?.label || '当前数据源';
  const selectorConnectorKey = isDemoSource
    ? selectedDemoKnowledge?.id || '__demo__'
    : selectedConnectorId;

  return (
    <WizardBody>
      <WizardNote>
        <strong style={{ color: '#30354a' }}>
          {isDemoSource ? '选择样例资产' : '选择数据资产'}
        </strong>
        <div style={{ marginTop: 6 }}>
          {isDemoSource
            ? `当前样例数据源为 “${selectedDemoKnowledge?.name || '系统样例'}”，请选择要引入的主题表或核心字段视图。`
            : `当前数据源为 “${selectedConnectorLabel}”。已导入资产会锁定显示，避免重复引入。`}
        </div>
      </WizardNote>

      <FieldCluster>
        <SectionTitle>
          <RequiredMark>*</RequiredMark>
          {isDemoSource ? '选择主题资产' : '选择数据表'}
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
          lockedSelectedTableItems={lockedSelectedTableItems}
          lockedSelectedValues={lockedSelectedTableValues}
          prefixOptions={prefixOptions}
          selectableFilteredValues={selectableFilteredValues}
          selectedConnectorId={selectorConnectorKey}
          selectedCount={displaySelectedTableValues.length}
          selectedTableItems={selectedTableItems}
          selectedTableValues={selectedTableValues}
          scopeOptions={scopeOptions}
          tablePrefixKeyword={tablePrefixKeyword}
          toggleSelectedTable={toggleSelectedTable}
        />
      </FieldCluster>

      <WizardFooter>
        <div>
          <Text type="secondary">
            {isDemoSource
              ? '下一步补充知识配置。'
              : '支持按 schema 和表名前缀筛选，并批量选择当前结果。'}
          </Text>
        </div>
        <Space size={12}>
          <LightButton onClick={onBack}>上一步</LightButton>
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
