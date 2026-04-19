import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AssetDetailContent from './AssetDetailContent';

describe('AssetDetailContent', () => {
  const baseProps = () => ({
    activeDetailAsset: {
      id: 'asset-1',
      name: '订单',
      description: '订单核心资产',
      fieldCount: 2,
      kind: 'model',
      fields: [
        { name: 'order_id', type: 'string', isPrimaryKey: true },
        { name: 'amount', type: 'number', expression: 'sum(amount)' },
      ],
      suggestedQuestions: ['订单数是多少？'],
    } as any,
    detailTab: 'overview' as const,
    detailFieldKeyword: '',
    detailFieldFilter: 'all' as const,
    detailAssetFields: [
      {
        key: 'order_id',
        fieldName: 'order_id',
        aiName: '订单ID',
        fieldType: 'string',
        isPrimaryKey: true,
      },
    ],
    canCreateKnowledgeArtifacts: true,
    onClose: jest.fn(),
    onNavigateModeling: jest.fn(),
    onCreateRuleDraft: jest.fn(),
    onCreateSqlTemplateDraft: jest.fn(),
    onChangeDetailTab: jest.fn(),
    onChangeFieldKeyword: jest.fn(),
    onChangeFieldFilter: jest.fn(),
  });

  it('renders overview metadata, filters and field table summary', () => {
    const html = renderToStaticMarkup(<AssetDetailContent {...baseProps()} />);

    expect(html).toContain('资产详情');
    expect(html).toContain('订单');
    expect(html).toContain('全部字段');
    expect(html).toContain('主键 1');
    expect(html).toContain('订单ID');
    expect(html).toContain('去建模');
  });

  it('renders usage guidance and artifact actions on the usage tab', () => {
    const html = renderToStaticMarkup(
      <AssetDetailContent {...baseProps()} detailTab="usage" />,
    );

    expect(html).toContain('推荐问法');
    expect(html).toContain('订单数是多少？');
    expect(html).toContain('使用建议');
    expect(html).toContain('新建 SQL 模板');
    expect(html).toContain('新建分析规则');
  });
});
