import resolveKnowledgeWorkbenchDraftDirty from './resolveKnowledgeWorkbenchDraftDirty';

describe('resolveKnowledgeWorkbenchDraftDirty', () => {
  it('returns the rule draft state for instructions', () => {
    expect(
      resolveKnowledgeWorkbenchDraftDirty({
        isRuleDraftDirty: true,
        isSqlDraftDirty: false,
        section: 'instructions',
      }),
    ).toBe(true);
  });

  it('returns the sql draft state for sql templates', () => {
    expect(
      resolveKnowledgeWorkbenchDraftDirty({
        isRuleDraftDirty: false,
        isSqlDraftDirty: true,
        section: 'sqlTemplates',
      }),
    ).toBe(true);
  });

  it('returns false for non-editor workbench sections', () => {
    expect(
      resolveKnowledgeWorkbenchDraftDirty({
        isRuleDraftDirty: true,
        isSqlDraftDirty: true,
        section: 'overview',
      }),
    ).toBe(false);
  });
});
