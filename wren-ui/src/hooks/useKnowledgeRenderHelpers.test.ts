import {
  isDemoKnowledgeSidebarEntry,
  resolveKnowledgeSidebarFallbackAssetCount,
  resolveRuleDraftDisplay,
  resolveRuleDraftContent,
  resolveRuleDraftSummary,
} from './useKnowledgeRenderHelpers';

describe('useKnowledgeRenderHelpers', () => {
  it('marks demo or missing-record item as disabled entry', () => {
    expect(
      isDemoKnowledgeSidebarEntry({
        name: '电商销售分析',
        demo: true,
        record: {},
      }),
    ).toBe(true);
    expect(
      isDemoKnowledgeSidebarEntry({
        name: '电商销售分析',
        demo: false,
      }),
    ).toBe(true);
    expect(
      isDemoKnowledgeSidebarEntry({
        name: '电商销售分析',
        demo: false,
        record: { id: 'kb-1' },
      }),
    ).toBe(false);
  });

  it('resolves sidebar fallback count from item count then reference', () => {
    expect(
      resolveKnowledgeSidebarFallbackAssetCount({
        name: '电商销售分析',
        assetCount: 7,
      }),
    ).toBe(7);

    expect(
      resolveKnowledgeSidebarFallbackAssetCount({
        name: '电商销售分析',
      }),
    ).toBeGreaterThanOrEqual(0);
  });

  it('resolves rule draft summary/content through parser', () => {
    const instruction = {
      id: 1,
      instruction: '【规则描述】规则A\n【规则内容】只看有效订单',
      questions: [],
      isDefault: true,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
    };

    expect(resolveRuleDraftSummary(instruction)).toBe('规则A');
    expect(resolveRuleDraftContent(instruction)).toBe('只看有效订单');
    expect(resolveRuleDraftDisplay(instruction)).toEqual({
      summary: '规则A',
      content: '只看有效订单',
    });
  });
});
