import {
  resolveAssetDraftPreviews,
  resolveSelectedAssetSeeds,
  resolveWizardPreviewAssets,
} from './useKnowledgeAssetWizard';

describe('useKnowledgeAssetWizard helpers', () => {
  const demoKnowledge = {
    id: 'demo-kb-ecommerce',
    name: '电商订单数据（E-commerce）',
    description: 'demo',
    assetName: '电商订单主题视图',
    owner: '系统样例',
    fields: [
      {
        key: 'f1',
        fieldName: 'order_id',
        fieldType: 'INTEGER',
        aiName: '订单ID',
      },
    ],
    suggestedQuestions: ['Q1'],
  };

  it('builds preview assets from demo fallback', () => {
    const result = resolveWizardPreviewAssets({
      assets: [],
      selectedDemoKnowledge: demoKnowledge,
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('电商订单主题视图');
  });

  it('builds connector seed when selecting connector source', () => {
    const selected = resolveSelectedAssetSeeds({
      connectorTables: [
        {
          name: 'orders',
          primaryKey: 'order_id',
          columns: [
            { name: 'order_id', type: 'INTEGER' },
            { name: 'amount', type: 'DECIMAL' },
          ],
          properties: { schema: 'sales', table: 'orders' },
        },
      ],
      connectors: [{ id: 'c1', displayName: 'MySQL', type: 'MYSQL' }],
      demoTableOptions: [],
      isDemoSource: false,
      knowledgeOwner: '工作区成员',
      selectedConnectorId: 'c1',
      selectedDemoKnowledge: null,
      selectedDemoTable: 'sales.orders',
      wizardPreviewAssets: [],
    })[0];
    expect(selected?.id).toBe('connector-draft-c1-sales.orders');
    expect(selected?.sourceTableName).toBe('sales.orders');
    expect(selected?.connectorTableName).toBe('orders');
    expect(selected?.fieldCount).toBe(2);
    expect(selected?.primaryKey).toBe('order_id');
  });

  it('builds multiple connector seeds when selecting multiple tables', () => {
    const selected = resolveSelectedAssetSeeds({
      connectorTables: [
        {
          name: 'orders',
          primaryKey: 'order_id',
          columns: [{ name: 'order_id', type: 'INTEGER' }],
          properties: { schema: 'sales', table: 'orders' },
        },
        {
          name: 'customers',
          primaryKey: 'customer_id',
          columns: [{ name: 'customer_id', type: 'INTEGER' }],
          properties: { schema: 'sales', table: 'customers' },
        },
      ],
      connectors: [{ id: 'c1', displayName: 'MySQL', type: 'MYSQL' }],
      demoTableOptions: [],
      isDemoSource: false,
      knowledgeOwner: '工作区成员',
      selectedConnectorId: 'c1',
      selectedDemoKnowledge: null,
      selectedDemoTable: ['sales.orders', 'sales.customers'],
      wizardPreviewAssets: [],
    });

    expect(selected.map((item) => item.sourceTableName)).toEqual([
      'sales.orders',
      'sales.customers',
    ]);
  });

  it('applies draft values onto selected seed', () => {
    const seed = resolveSelectedAssetSeeds({
      connectorTables: [],
      connectors: [],
      demoTableOptions: [
        {
          label: '电商订单主题视图',
          value: 'demo-kb-ecommerce::theme-view',
        },
      ],
      isDemoSource: true,
      knowledgeOwner: '系统样例',
      selectedConnectorId: undefined,
      selectedDemoKnowledge: demoKnowledge,
      selectedDemoTable: 'demo-kb-ecommerce::theme-view',
      wizardPreviewAssets: [],
    })[0];
    const preview = resolveAssetDraftPreviews({
      assetDraft: {
        name: '新资产名称',
        description: '新的描述',
        important: true,
      },
      knowledgeOwner: '系统样例',
      selectedAssetSeeds: seed ? [seed] : [],
    })[0];
    expect(preview?.name).toBe('新资产名称');
    expect(preview?.description).toBe('新的描述');
  });

  it('applies a shared prefix when previewing a batch of selected assets', () => {
    const previews = resolveAssetDraftPreviews({
      assetDraft: {
        name: '业务_',
        description: '批量导入资产',
        important: false,
      },
      knowledgeOwner: '工作区成员',
      selectedAssetSeeds: [
        {
          id: 'a1',
          name: 'sales.orders',
          description: 'orders',
          kind: 'model',
          fieldCount: 3,
          owner: 'owner',
          fields: [],
        },
        {
          id: 'a2',
          name: 'sales.customers',
          description: 'customers',
          kind: 'model',
          fieldCount: 2,
          owner: 'owner',
          fields: [],
        },
      ],
    });

    expect(previews.map((preview) => preview.name)).toEqual([
      '业务_sales.orders',
      '业务_sales.customers',
    ]);
    expect(
      previews.every((preview) => preview.description === '批量导入资产'),
    ).toBe(true);
  });
});
