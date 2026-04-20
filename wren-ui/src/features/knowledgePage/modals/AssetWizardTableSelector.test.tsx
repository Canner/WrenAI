import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AssetWizardTableSelector from './AssetWizardTableSelector';
import {
  buildAssetTableSelectorGroups,
  buildAssetTableSelectorItems,
  resolveAssetTableQuickFilters,
} from './assetWizardSourceStepSupport';

describe('AssetWizardTableSelector', () => {
  it('renders grouped multi-table controls for workspace connectors', () => {
    const assetTableOptions = [
      {
        label: 'report_demo.dwd_order_task',
        value: 'report_demo.dwd_order_task',
      },
      {
        label: 'report_demo.dwd_order_lottery',
        value: 'report_demo.dwd_order_lottery',
      },
      {
        label: 'report_mart.fact_order_summary · 已导入',
        value: 'report_mart.fact_order_summary',
        disabled: true,
        imported: true,
      },
    ];
    const selectorItems = buildAssetTableSelectorItems(assetTableOptions);
    const quickFilters = resolveAssetTableQuickFilters(assetTableOptions);
    const filteredItems = selectorItems;
    const selectedItems = selectorItems.filter(
      (item) => item.value === 'report_demo.dwd_order_task',
    );
    const lockedItems = selectorItems.filter((item) => item.imported);
    const html = renderToStaticMarkup(
      <AssetWizardTableSelector
        activeScopeLabel="all"
        assetTableCount={assetTableOptions.length}
        availableCount={2}
        filteredAssetTableItems={filteredItems}
        groupedAssetTableItems={buildAssetTableSelectorGroups(filteredItems)}
        hideImportedTables={false}
        importedCount={1}
        lockedSelectedTableItems={lockedItems}
        lockedSelectedValues={lockedItems.map((item) => item.value)}
        onClearSelected={jest.fn()}
        onHideImportedTablesChange={jest.fn()}
        onPrefixSuggestionSelect={jest.fn()}
        onSelectAllFiltered={jest.fn()}
        onScopeLabelChange={jest.fn()}
        onTablePrefixKeywordChange={jest.fn()}
        onToggleGroupSelection={jest.fn()}
        prefixOptions={quickFilters.prefixOptions}
        selectableFilteredValues={[
          'report_demo.dwd_order_task',
          'report_demo.dwd_order_lottery',
        ]}
        selectedConnectorId="connector-1"
        selectedCount={2}
        selectedTableItems={selectedItems}
        selectedTableValues={['report_demo.dwd_order_task']}
        scopeOptions={quickFilters.scopeOptions}
        tablePrefixKeyword=""
        toggleSelectedTable={jest.fn()}
      />,
    );

    expect(html).toContain('schema 过滤');
    expect(html).toContain('常用前缀');
    expect(html).toContain('report_demo · 2');
    expect(html).toContain('全选本组');
    expect(html).toContain('report_demo.dwd_order_task');
    expect(html).toContain('已纳入知识库');
    expect(html).toContain('待引入 1 张');
    expect(html).toContain(
      '共 3 张表 · 已导入 1 张 · 可引入 2 张 · 当前已选 2 张',
    );
  });
});
