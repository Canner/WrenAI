import { buildKnowledgeWorkbenchEditorOpenPlan } from './buildKnowledgeWorkbenchEditorOpenPlan';

describe('buildKnowledgeWorkbenchEditorOpenPlan', () => {
  it('uses counterpart dirty state when switching from another section', () => {
    expect(
      buildKnowledgeWorkbenchEditorOpenPlan({
        activeWorkbenchSection: 'instructions',
        targetSection: 'sqlTemplates',
        currentEditingId: null,
        nextEditingId: null,
        hasDraftValues: false,
        drawerOpen: false,
        currentSectionDirty: false,
        counterpartSectionDirty: true,
      }),
    ).toEqual({
      dirtyBeforeOpen: true,
      isSwitchingEditor: true,
      shouldOnlyEnsureDrawerOpen: false,
    });
  });

  it('allows simply re-opening the drawer when staying on the same editor without section switch', () => {
    expect(
      buildKnowledgeWorkbenchEditorOpenPlan({
        activeWorkbenchSection: 'sqlTemplates',
        targetSection: 'sqlTemplates',
        currentEditingId: 'sql-1',
        nextEditingId: 'sql-1',
        hasDraftValues: false,
        drawerOpen: true,
        currentSectionDirty: true,
        counterpartSectionDirty: false,
        switchSection: false,
      }),
    ).toEqual({
      dirtyBeforeOpen: false,
      isSwitchingEditor: false,
      shouldOnlyEnsureDrawerOpen: true,
    });
  });

  it('uses current section dirty state when duplicating inside the same section', () => {
    expect(
      buildKnowledgeWorkbenchEditorOpenPlan({
        activeWorkbenchSection: 'instructions',
        targetSection: 'instructions',
        currentEditingId: 'rule-1',
        nextEditingId: 'rule-1',
        hasDraftValues: true,
        drawerOpen: true,
        currentSectionDirty: true,
        counterpartSectionDirty: false,
        switchSection: false,
      }),
    ).toEqual({
      dirtyBeforeOpen: true,
      isSwitchingEditor: true,
      shouldOnlyEnsureDrawerOpen: false,
    });
  });
});
