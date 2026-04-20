import {
  buildAssetTableSelectorGroups,
  buildAssetTableSelectorItems,
  matchesTablePrefix,
  resolveAssetTableQuickFilters,
  resolveVisibleAssetTableSelectorItems,
} from './assetWizardSourceStepSupport';

describe('assetWizardSourceStepSupport', () => {
  const options = [
    {
      label: 'sales.orders',
      value: 'sales.orders',
    },
    {
      label: 'sales.customers · 已导入',
      value: 'sales.customers',
      disabled: true,
      imported: true,
    },
    {
      label: 'mart.fact_orders',
      value: 'mart.fact_orders',
    },
  ];

  it('matches prefix against label segments and qualified values', () => {
    expect(matchesTablePrefix(options[0], 'sal')).toBe(true);
    expect(matchesTablePrefix(options[2], 'fact_')).toBe(true);
    expect(matchesTablePrefix(options[2], 'mart.fact_')).toBe(true);
    expect(matchesTablePrefix(options[2], 'cust')).toBe(false);
  });

  it('builds table selector metadata', () => {
    expect(buildAssetTableSelectorItems(options)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 'sales.orders',
          baseName: 'orders',
          scopeLabel: 'sales',
          statusLabel: '可引入',
        }),
        expect.objectContaining({
          value: 'sales.customers',
          baseName: 'customers',
          scopeLabel: 'sales',
          statusLabel: '已导入',
        }),
      ]),
    );
  });

  it('keeps selected items visible while filtering out imported rows', () => {
    const visible = resolveVisibleAssetTableSelectorItems({
      activeScopeLabel: 'all',
      assetTableOptions: options,
      hideImportedTables: true,
      selectedTableValues: ['sales.customers'],
      tablePrefixKeyword: 'fact_',
    });

    expect(visible.map((item) => item.value)).toEqual([
      'sales.customers',
      'mart.fact_orders',
    ]);
  });

  it('builds quick filters for schema groups and common prefixes', () => {
    expect(resolveAssetTableQuickFilters(options)).toEqual({
      scopeOptions: [
        { label: '全部', value: 'all', count: 3 },
        { label: 'sales', value: 'sales', count: 2 },
        { label: 'mart', value: 'mart', count: 1 },
      ],
      prefixOptions: [{ label: 'fact_', value: 'fact_', count: 1 }],
    });
  });

  it('groups selector items by scope label', () => {
    const groups = buildAssetTableSelectorGroups(
      buildAssetTableSelectorItems(options),
    );

    expect(groups).toEqual([
      expect.objectContaining({
        key: 'sales',
        itemCount: 2,
        selectableCount: 1,
      }),
      expect.objectContaining({
        key: 'mart',
        itemCount: 1,
        selectableCount: 1,
      }),
    ]);
  });
});
