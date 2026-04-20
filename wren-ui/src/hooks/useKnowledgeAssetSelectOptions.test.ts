import {
  resolveKnowledgeAssetDatabaseOptions,
  resolveKnowledgeAssetTableOptions,
  resolveKnowledgeConnectorOptions,
} from './useKnowledgeAssetSelectOptions';

describe('useKnowledgeAssetSelectOptions helpers', () => {
  it('maps connector options with display name and type', () => {
    expect(
      resolveKnowledgeConnectorOptions([
        { id: 'c1', displayName: 'Postgres 主库', type: 'postgres' },
      ]),
    ).toEqual([{ label: 'Postgres 主库 · postgres', value: 'c1' }]);
  });

  it('uses demo database options when demo source is selected', () => {
    expect(
      resolveKnowledgeAssetDatabaseOptions({
        isDemoSource: true,
        demoDatabaseOptions: [{ label: '样例库', value: 'demo' }],
        connectorOptions: [{ label: '连接器', value: 'connector' }],
      }),
    ).toEqual([{ label: '样例库', value: 'demo' }]);
  });

  it('maps runtime assets to table options and disables imported tables', () => {
    expect(
      resolveKnowledgeAssetTableOptions({
        assets: [{ sourceTableName: 'sales.orders' }],
        isDemoSource: false,
        demoTableOptions: [{ label: '样例表', value: 'demo-table' }],
        connectorTables: [
          {
            name: 'orders',
            primaryKey: 'order_id',
            columns: [],
            properties: { schema: 'sales', table: 'orders' },
          },
          {
            name: 'customers',
            columns: [],
            properties: { schema: 'sales', table: 'customers' },
          },
        ],
      }),
    ).toEqual([
      {
        disabled: true,
        imported: true,
        label: 'sales.orders · 已导入',
        value: 'sales.orders',
      },
      {
        disabled: false,
        imported: false,
        label: 'sales.customers',
        value: 'sales.customers',
      },
    ]);
  });
});
