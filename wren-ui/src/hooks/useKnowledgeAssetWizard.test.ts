import {
  resolveAssetDraftPreview,
  resolveSelectedAssetSeed,
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
    const selected = resolveSelectedAssetSeed({
      connectors: [{ id: 'c1', displayName: 'MySQL', type: 'MYSQL' }],
      demoTableOptions: [],
      isDemoSource: false,
      knowledgeOwner: '工作区成员',
      selectedConnectorId: 'c1',
      selectedDemoKnowledge: null,
      selectedDemoTable: undefined,
      wizardPreviewAssets: [],
    });
    expect(selected?.id).toBe('connector-draft-c1');
  });

  it('applies draft values onto selected seed', () => {
    const seed = resolveSelectedAssetSeed({
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
    });
    const preview = resolveAssetDraftPreview({
      assetDraft: {
        name: '新资产名称',
        description: '新的描述',
        important: true,
      },
      knowledgeOwner: '系统样例',
      selectedAssetSeed: seed,
    });
    expect(preview?.name).toBe('新资产名称');
    expect(preview?.description).toBe('新的描述');
  });
});
