import { buildKnowledgeWorkbenchAssetEditorLifecycleInput } from './buildKnowledgeWorkbenchAssetEditorLifecycleInput';
import { buildKnowledgeWorkbenchAssetEditorOpenInput } from './buildKnowledgeWorkbenchAssetEditorOpenInput';
import { buildKnowledgeWorkbenchEditorEntryActionsInput } from './buildKnowledgeWorkbenchEditorEntryActionsInput';

describe('buildKnowledgeWorkbenchAssetEditorActionsInputs', () => {
  const baseArgs = () => ({
    activeWorkbenchSection: 'sqlTemplates' as const,
    applySuccessMessage: 'applied',
    buildDraftFromAsset: jest.fn((asset) => ({ description: asset.id })),
    buildDuplicateDraft: jest.fn((item) => ({ description: item.id })),
    buildEditorValues: jest.fn(({ item, draftValues }) => ({
      id: item?.id,
      ...draftValues,
    })),
    confirmDeleteEntry: jest.fn(async () => true),
    contextAsset: { id: 'asset-1' } as any,
    currentEditingId: 'sql-1',
    currentSectionDirty: true,
    counterpartSectionDirty: false,
    createFromAssetSuccessMessage: 'created',
    drawerOpen: false,
    duplicateSuccessMessage: 'duplicated',
    editingItemId: 'sql-1',
    emptyValues: { sql: '' },
    entityLabel: 'SQL 模板',
    form: { setFieldsValue: jest.fn() },
    getItemId: jest.fn((item) => item.id),
    onChangeWorkbenchSection: jest.fn(),
    onCreateDraftFromAsset: jest.fn(),
    onDeleteItem: jest.fn(),
    onOpenDetail: jest.fn(),
    onResetEditor: jest.fn(),
    onSubmitDetail: jest.fn(async () => undefined),
    runWithDirtyGuard: jest.fn(async (_dirty, action) => {
      await action();
      return true;
    }),
    setContextAssetId: jest.fn(),
    setDrawerOpen: jest.fn(),
    syncDraftBaseline: jest.fn(),
    targetSection: 'sqlTemplates' as const,
  });

  it('maps lifecycle input with the expected dirty key name', () => {
    const args = baseArgs();

    expect(
      buildKnowledgeWorkbenchAssetEditorLifecycleInput(args),
    ).toMatchObject({
      applySuccessMessage: 'applied',
      contextAsset: { id: 'asset-1' },
      emptyValues: { sql: '' },
      form: args.form,
      isDraftDirty: true,
      onResetEditor: args.onResetEditor,
      onSubmitDetail: args.onSubmitDetail,
      runWithDirtyGuard: args.runWithDirtyGuard,
      setContextAssetId: args.setContextAssetId,
      setDrawerOpen: args.setDrawerOpen,
      syncDraftBaseline: args.syncDraftBaseline,
    });
  });

  it('maps open action input with shared editor-open fields', () => {
    const args = baseArgs();

    expect(buildKnowledgeWorkbenchAssetEditorOpenInput(args)).toMatchObject({
      activeWorkbenchSection: 'sqlTemplates',
      targetSection: 'sqlTemplates',
      currentEditingId: 'sql-1',
      drawerOpen: false,
      currentSectionDirty: true,
      counterpartSectionDirty: false,
      onChangeWorkbenchSection: args.onChangeWorkbenchSection,
      onOpenDetail: args.onOpenDetail,
      form: args.form,
      syncDraftBaseline: args.syncDraftBaseline,
      setContextAssetId: args.setContextAssetId,
      setDrawerOpen: args.setDrawerOpen,
      buildEditorValues: args.buildEditorValues,
      runWithDirtyGuard: args.runWithDirtyGuard,
    });
  });

  it('maps entry action input with creation/duplicate/delete wiring', () => {
    const args = baseArgs();
    const clearActiveEditorDraft = jest.fn();
    const openEditor = jest.fn(async () => true);

    expect(
      buildKnowledgeWorkbenchEditorEntryActionsInput({
        ...args,
        clearActiveEditorDraft,
        openEditor,
      }),
    ).toMatchObject({
      buildDraftFromAsset: args.buildDraftFromAsset,
      buildDuplicateDraft: args.buildDuplicateDraft,
      clearActiveEditorDraft,
      confirmDeleteEntry: args.confirmDeleteEntry,
      createFromAssetSuccessMessage: 'created',
      duplicateSuccessMessage: 'duplicated',
      editingItemId: 'sql-1',
      entityLabel: 'SQL 模板',
      getItemId: args.getItemId,
      onCreateDraftFromAsset: args.onCreateDraftFromAsset,
      onDeleteItem: args.onDeleteItem,
      openEditor,
    });
  });
});
