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

  it('maps runtime assets to table options when connector source is selected', () => {
    expect(
      resolveKnowledgeAssetTableOptions({
        isDemoSource: false,
        demoTableOptions: [{ label: '样例表', value: 'demo-table' }],
        assets: [
          { id: 'a1', name: 'orders' },
          { id: 'a2', name: 'customers' },
        ],
      }),
    ).toEqual([
      { label: 'orders', value: 'a1' },
      { label: 'customers', value: 'a2' },
    ]);
  });
});
