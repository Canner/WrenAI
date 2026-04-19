import { buildKnowledgeModelingSummary } from './buildKnowledgeModelingSummary';

describe('buildKnowledgeModelingSummary', () => {
  it('counts unique relations across models and relation fields', () => {
    expect(
      buildKnowledgeModelingSummary({
        models: [
          {
            relationFields: [{ relationId: 1 }, { relationId: 2 }],
          },
          {
            relationFields: [{ relationId: 2 }, { relationId: 3 }],
          },
        ],
        views: [{ id: 'view-1' }],
      }),
    ).toEqual({
      modelCount: 2,
      viewCount: 1,
      relationCount: 3,
    });
  });

  it('falls back to zero counts for empty diagrams', () => {
    expect(buildKnowledgeModelingSummary(null)).toEqual({
      modelCount: 0,
      viewCount: 0,
      relationCount: 0,
    });
  });
});
