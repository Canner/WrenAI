import {
  summarizePreviewData,
  toStructuredRecommendationItem,
} from '../recommendationIntelligence';

describe('recommendationIntelligence', () => {
  it('summarizes preview columns into dimensions and measures', () => {
    expect(
      summarizePreviewData({
        columns: [
          { name: 'dept_name', type: 'VARCHAR' },
          { name: 'avg_salary', type: 'DOUBLE' },
        ],
        data: [['Engineering', 100]],
      } as any),
    ).toEqual({
      previewColumnCount: 2,
      previewColumns: [
        { name: 'dept_name', type: 'VARCHAR', role: 'dimension' },
        { name: 'avg_salary', type: 'DOUBLE', role: 'measure' },
      ],
      previewRowCount: 1,
    });
  });

  it('normalizes raw recommendation payloads into structured draft-first items', () => {
    expect(
      toStructuredRecommendationItem({
        category: 'Comparative Questions',
        question: '比较不同部门的平均薪资差异',
      }),
    ).toEqual({
      category: 'compare',
      interactionMode: 'draft_to_composer',
      label: '比较不同部门的平均薪资差异',
      prompt: '比较不同部门的平均薪资差异',
      sql: null,
      suggestedIntent: 'ASK',
    });
  });

  it('keeps chart-oriented suggestions as chart follow-ups', () => {
    expect(
      toStructuredRecommendationItem({
        question: '生成一个展示各部门平均薪资的柱状图',
      }),
    ).toEqual({
      category: 'chart_followup',
      interactionMode: 'draft_to_composer',
      label: '生成一个展示各部门平均薪资的柱状图',
      prompt: '生成一个展示各部门平均薪资的柱状图',
      sql: null,
      suggestedIntent: 'CHART',
    });
  });
});
