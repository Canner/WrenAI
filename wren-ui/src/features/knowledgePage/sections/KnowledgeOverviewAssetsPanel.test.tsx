import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import KnowledgeOverviewAssetsPanel from './KnowledgeOverviewAssetsPanel';

describe('KnowledgeOverviewAssetsPanel', () => {
  const baseProps = () => ({
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
    showKnowledgeAssetsLoading: false,
    hasMoreAssets: false,
    loadMoreSentinelRef: { current: null },
    isReadonlyKnowledgeBase: false,
    isSnapshotReadonlyKnowledgeBase: false,
    isKnowledgeMutationDisabled: false,
    historicalSnapshotReadonlyHint: 'readonly',
    onOpenAssetWizard: jest.fn(),
    onOpenAssetDetail: jest.fn(),
  });

  it('renders create card and asset gallery cards when assets exist', () => {
    const html = renderToStaticMarkup(
      <KnowledgeOverviewAssetsPanel {...baseProps()} />,
    );

    expect(html).toContain('knowledge-add-asset-card');
    expect(html).toContain('knowledge-asset-card');
    expect(html).toContain('订单核心资产');
    expect(html).toContain('12 个字段');
  });

  it('renders loading overlay copy when assets are still syncing', () => {
    const html = renderToStaticMarkup(
      <KnowledgeOverviewAssetsPanel
        {...baseProps()}
        showKnowledgeAssetsLoading
      />,
    );

    expect(html).toContain('正在同步知识库内容…');
    expect(html).toContain('当前知识库的表结构与字段信息正在加载');
  });

  it('renders empty-state copy for readonly sample workspaces', () => {
    const html = renderToStaticMarkup(
      <KnowledgeOverviewAssetsPanel
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
    expect(html).not.toContain('knowledge-add-asset-card');
  });
});
