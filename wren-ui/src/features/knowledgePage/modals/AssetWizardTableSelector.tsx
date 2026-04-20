import { CloseOutlined } from '@ant-design/icons';
import { Button, Checkbox, Empty, Input, Space, Tag, Typography } from 'antd';
import type { CSSProperties } from 'react';
import type {
  AssetTablePrefixOption,
  AssetTableScopeOption,
  AssetTableSelectorGroup,
  AssetTableSelectorItem,
} from './assetWizardSourceStepSupport';

const { Text } = Typography;

const SELECTOR_SHELL_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.4fr) minmax(300px, 0.95fr)',
  gap: 14,
};

const SELECTOR_PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 340,
  border: '1px solid rgba(15, 23, 42, 0.08)',
  borderRadius: 14,
  background: '#fff',
  overflow: 'hidden',
};

const SELECTOR_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '12px 14px',
  borderBottom: '1px solid rgba(15, 23, 42, 0.06)',
  background: '#fafbfd',
};

const SELECTOR_LIST_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 12,
  maxHeight: 340,
  overflowY: 'auto',
};

const VALUE_TEXT_STYLE: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#8a91a5',
  lineHeight: 1.4,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const FILTER_GROUP_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
};

const FILTER_CHIP_STYLE = (active: boolean): CSSProperties => ({
  borderRadius: 999,
  padding: '4px 10px',
  border: active
    ? '1px solid rgba(91, 75, 219, 0.28)'
    : '1px solid rgba(15, 23, 42, 0.08)',
  background: active ? 'rgba(123, 85, 232, 0.08)' : '#fff',
  color: active ? '#5b4bdb' : '#475467',
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1.2,
});

const GROUP_BLOCK_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const GROUP_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
};

const buildTableRowStyle = ({
  checked,
  disabled,
}: {
  checked: boolean;
  disabled?: boolean;
}): CSSProperties => ({
  width: '100%',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 12px',
  borderRadius: 12,
  border: checked
    ? '1px solid rgba(91, 75, 219, 0.24)'
    : '1px solid rgba(15, 23, 42, 0.08)',
  background: disabled
    ? '#f8fafc'
    : checked
      ? 'rgba(123, 85, 232, 0.06)'
      : '#fff',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.72 : 1,
  textAlign: 'left',
});

type AssetWizardTableSelectorProps = {
  activeScopeLabel: string;
  assetTableCount: number;
  availableCount: number;
  filteredAssetTableItems: AssetTableSelectorItem[];
  groupedAssetTableItems: AssetTableSelectorGroup[];
  hideImportedTables: boolean;
  importedCount: number;
  onClearSelected: () => void;
  onHideImportedTablesChange: (checked: boolean) => void;
  onPrefixSuggestionSelect: (keyword: string) => void;
  onSelectAllFiltered: () => void;
  onScopeLabelChange: (scope: string) => void;
  onTablePrefixKeywordChange: (keyword: string) => void;
  onToggleGroupSelection: (values: string[]) => void;
  prefixOptions: AssetTablePrefixOption[];
  selectableFilteredValues: string[];
  selectedConnectorId?: string;
  selectedCount: number;
  selectedTableItems: AssetTableSelectorItem[];
  selectedTableValues: string[];
  scopeOptions: AssetTableScopeOption[];
  tablePrefixKeyword: string;
  toggleSelectedTable: (value: string) => void;
};

const renderScopeChipLabel = (scope: AssetTableScopeOption) =>
  `${scope.label} · ${scope.count}`;

const renderPrefixChipLabel = (prefix: AssetTablePrefixOption) =>
  `${prefix.label} · ${prefix.count}`;

export default function AssetWizardTableSelector({
  activeScopeLabel,
  assetTableCount,
  availableCount,
  filteredAssetTableItems,
  groupedAssetTableItems,
  hideImportedTables,
  importedCount,
  onClearSelected,
  onHideImportedTablesChange,
  onPrefixSuggestionSelect,
  onSelectAllFiltered,
  onScopeLabelChange,
  onTablePrefixKeywordChange,
  onToggleGroupSelection,
  prefixOptions,
  selectableFilteredValues,
  selectedConnectorId,
  selectedCount,
  selectedTableItems,
  selectedTableValues,
  scopeOptions,
  tablePrefixKeyword,
  toggleSelectedTable,
}: AssetWizardTableSelectorProps) {
  const selectedValueSet = new Set(selectedTableValues);

  return (
    <>
      <Space
        size={8}
        style={{
          width: '100%',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
        wrap
      >
        <Input
          allowClear
          value={tablePrefixKeyword}
          placeholder="按 schema / 表名前缀筛选，例如 report_demo / dwd_ / fact_"
          onChange={(event) => onTablePrefixKeywordChange(event.target.value)}
          style={{ flex: 1, minWidth: 300 }}
          disabled={!selectedConnectorId}
        />
        <Space size={8} wrap>
          <Checkbox
            checked={hideImportedTables}
            disabled={!selectedConnectorId}
            onChange={(event) =>
              onHideImportedTablesChange(event.target.checked)
            }
          >
            仅显示未导入
          </Checkbox>
          <Button
            size="small"
            disabled={selectableFilteredValues.length === 0}
            onClick={onSelectAllFiltered}
          >
            全选当前结果
          </Button>
          <Button
            size="small"
            disabled={selectedTableValues.length === 0}
            onClick={onClearSelected}
          >
            清空已选
          </Button>
        </Space>
      </Space>

      <Space
        direction="vertical"
        size={10}
        style={{ width: '100%', marginBottom: 10 }}
      >
        <div style={FILTER_GROUP_STYLE}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            schema 过滤
          </Text>
            {scopeOptions.map((scope) => (
              <button
                key={scope.value}
                type="button"
                disabled={!selectedConnectorId}
                onClick={() => onScopeLabelChange(scope.value)}
                style={FILTER_CHIP_STYLE(activeScopeLabel === scope.value)}
                data-testid="asset-table-scope-chip"
                data-scope-value={scope.value}
              >
                {renderScopeChipLabel(scope)}
              </button>
            ))}
        </div>
        {prefixOptions.length > 0 && (
          <div style={FILTER_GROUP_STYLE}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              常用前缀
            </Text>
            {prefixOptions.map((prefix) => (
              <button
                key={prefix.value}
                type="button"
                disabled={!selectedConnectorId}
                onClick={() => onPrefixSuggestionSelect(prefix.value)}
                style={FILTER_CHIP_STYLE(tablePrefixKeyword === prefix.value)}
                data-testid="asset-table-prefix-chip"
                data-prefix-value={prefix.value}
              >
                {renderPrefixChipLabel(prefix)}
              </button>
            ))}
          </div>
        )}
      </Space>

      <div style={SELECTOR_SHELL_STYLE}>
        <div style={SELECTOR_PANEL_STYLE}>
          <div style={SELECTOR_HEADER_STYLE}>
            <div>
              <Text strong style={{ fontSize: 13 }}>
                可选数据表
              </Text>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  当前筛选 {filteredAssetTableItems.length} 张，匹配 {groupedAssetTableItems.length}{' '}
                  个 schema 分组
                </Text>
              </div>
            </div>
            <Tag color="processing">支持批量引入</Tag>
          </div>
          <div style={SELECTOR_LIST_STYLE}>
            {!selectedConnectorId ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="请先选择数据库"
              />
            ) : groupedAssetTableItems.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="没有匹配的数据表，可尝试调整筛选条件"
              />
            ) : (
              groupedAssetTableItems.map((group) => {
                const selectableGroupValues = group.items
                  .filter((item) => !item.disabled)
                  .map((item) => item.value);
                const selectedGroupCount = selectableGroupValues.filter((value) =>
                  selectedValueSet.has(value),
                ).length;
                const allGroupSelectableSelected =
                  selectableGroupValues.length > 0 &&
                  selectedGroupCount === selectableGroupValues.length;

                return (
                  <div
                    key={group.key}
                    style={GROUP_BLOCK_STYLE}
                    data-testid="asset-table-group"
                    data-group-key={group.key}
                  >
                    <div style={GROUP_HEADER_STYLE}>
                      <Space size={8} wrap>
                        <Text strong style={{ fontSize: 13 }}>
                          {group.label}
                        </Text>
                        <Tag color="default">
                          {group.itemCount} 张表
                        </Tag>
                        {group.selectableCount > 0 ? (
                          <Tag color="purple">
                            可引入 {group.selectableCount} 张
                          </Tag>
                        ) : null}
                      </Space>
                      <Button
                        size="small"
                        type={allGroupSelectableSelected ? 'default' : 'link'}
                        disabled={selectableGroupValues.length === 0}
                        onClick={() =>
                          onToggleGroupSelection(selectableGroupValues)
                        }
                        data-testid="asset-table-group-toggle"
                        data-group-key={group.key}
                      >
                        {allGroupSelectableSelected ? '清空本组' : '全选本组'}
                      </Button>
                    </div>
                    {group.items.map((item) => {
                      const checked = selectedValueSet.has(item.value);
                      return (
                        <button
                          key={item.value}
                          type="button"
                          disabled={item.disabled}
                          onClick={() => toggleSelectedTable(item.value)}
                          style={buildTableRowStyle({
                            checked,
                            disabled: item.disabled,
                          })}
                          title={item.value}
                          data-testid="asset-table-option"
                          data-table-value={item.value}
                          data-table-base-name={item.baseName}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 12,
                              flex: 1,
                              minWidth: 0,
                            }}
                          >
                            <Checkbox checked={checked} disabled={item.disabled} />
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                                minWidth: 0,
                                flex: 1,
                              }}
                            >
                              <Text
                                strong
                                style={{
                                  fontSize: 13,
                                  lineHeight: 1.4,
                                  color: '#1f2937',
                                }}
                              >
                                {item.baseName}
                              </Text>
                              <span style={VALUE_TEXT_STYLE}>{item.value}</span>
                            </div>
                          </div>
                          <Tag color={item.imported ? 'default' : 'processing'}>
                            {item.statusLabel}
                          </Tag>
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div style={SELECTOR_PANEL_STYLE}>
          <div style={SELECTOR_HEADER_STYLE}>
            <div>
              <Text strong style={{ fontSize: 13 }}>
                已选数据表
              </Text>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  共 {selectedTableItems.length} 张，将一起创建资产
                </Text>
              </div>
            </div>
            {selectedTableItems.length > 0 && <Tag color="purple">批量导入</Tag>}
          </div>
          <div style={SELECTOR_LIST_STYLE}>
            {selectedTableItems.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="请选择一张或多张数据表"
              />
            ) : (
              selectedTableItems.map((item) => (
                <div
                  key={item.value}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1px solid rgba(91, 75, 219, 0.16)',
                    background: 'rgba(123, 85, 232, 0.04)',
                  }}
                  data-testid="asset-table-selected-item"
                  data-table-value={item.value}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Text
                      strong
                      style={{
                        display: 'block',
                        fontSize: 13,
                        lineHeight: 1.4,
                        color: '#1f2937',
                      }}
                    >
                      {item.baseName}
                    </Text>
                    <span style={VALUE_TEXT_STYLE}>{item.value}</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {item.scopeLabel}
                    </Text>
                  </div>
                  <Button
                    size="small"
                    type="text"
                    icon={<CloseOutlined />}
                    onClick={() => toggleSelectedTable(item.value)}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <Text type="secondary" style={{ fontSize: 12 }}>
        共 {assetTableCount} 张表 · 已导入 {importedCount} 张 · 可引入 {availableCount}{' '}
        张 · 当前已选 {selectedCount} 张
      </Text>
    </>
  );
}
