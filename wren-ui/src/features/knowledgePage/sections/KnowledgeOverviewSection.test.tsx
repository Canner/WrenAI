import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import KnowledgeOverviewSection from './KnowledgeOverviewSection';

jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  const React = jest.requireActual('react');
  return {
    ...actual,
    Drawer: ({ children }: any) => <div data-drawer>{children}</div>,
  };
});

jest.mock('@/features/knowledgePage/sections/AssetDetailContent', () => ({
  __esModule: true,
  default: ({ activeDetailAsset }: any) => (
    <div data-asset-detail>{activeDetailAsset?.name}</div>
  ),
}));

describe('KnowledgeOverviewSection', () => {
  const baseProps = () => ({
    previewFieldCount: 24,
    detailAssets: [
      {
        id: 'asset-1',
        name: '订单',
        kind: 'model',
        fieldCount: 12,
        description: '订单核心资产',
      },
    ] as any,
    renderedDetailAssets: [
      {
        id: 'asset-1',
        name: '订单',
        kind: 'model',
        fieldCount: 12,
        description: '订单核心资产',
      },
    ] as any,
    activeDetailAsset: {
      id: 'asset-1',
      name: '订单',
      kind: 'model',
      fieldCount: 12,
    } as any,
    detailTab: 'overview' as const,
    detailFieldKeyword: '',
    detailFieldFilter: 'all' as const,
    detailAssetFields: [],
    sqlListCount: 3,
    ruleListCount: 2,
    modelingSummary: { modelCount: 4, viewCount: 1, relationCount: 2 },
    showKnowledgeAssetsLoading: false,
    hasMoreAssets: false,
    loadMoreSentinelRef: { current: null },
    isReadonlyKnowledgeBase: false,
    isSnapshotReadonlyKnowledgeBase: false,
    isKnowledgeMutationDisabled: false,
    historicalSnapshotReadonlyHint: 'readonly',
    onOpenAssetWizard: jest.fn(),
    onOpenAssetDetail: jest.fn(),
    onCloseAssetDetail: jest.fn(),
    onOpenModeling: jest.fn(),
    onCreateRuleDraft: jest.fn(),
    onCreateSqlTemplateDraft: jest.fn(),
    onChangeDetailTab: jest.fn(),
    onChangeFieldKeyword: jest.fn(),
    onChangeFieldFilter: jest.fn(),
  });

  it('renders stats, asset gallery and detail drawer content', () => {
    const html = renderToStaticMarkup(
      <KnowledgeOverviewSection {...baseProps()} />,
    );

    expect(html).toContain('资产数');
    expect(html).toContain('字段预算');
    expect(html).toContain('SQL 模板');
    expect(html).toContain('添加资产');
    expect(html).toContain('订单核心资产');
    expect(html).toContain('data-drawer');
    expect(html).toContain('data-asset-detail');
  });

  it('renders readonly empty state copy when there are no assets', () => {
    const html = renderToStaticMarkup(
      <KnowledgeOverviewSection
        {...baseProps()}
        detailAssets={[]}
        renderedDetailAssets={[]}
        activeDetailAsset={null}
        isReadonlyKnowledgeBase
        isKnowledgeMutationDisabled
      />,
    );

    expect(html).toContain('知识库为空');
    expect(html).toContain('系统样例已预置结构与问答配置，可直接浏览体验。');
    expect(html).not.toContain('添加资产');
  });
});
