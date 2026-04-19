import {
  runKnowledgeWorkbenchCreateDraftFromAsset,
  runKnowledgeWorkbenchDeleteEntry,
  runKnowledgeWorkbenchDuplicateEntry,
} from './runKnowledgeWorkbenchEditorEntryEffects';

describe('runKnowledgeWorkbenchEditorEntryEffects', () => {
  it('opens a draft from asset and reports success only when the editor opens', async () => {
    const buildDraftFromAsset = jest.fn((asset) => ({
      description: asset.name,
    }));
    const openEditor = jest.fn(async () => true);
    const onCreateDraftFromAsset = jest.fn();
    const showSuccess = jest.fn();

    await runKnowledgeWorkbenchCreateDraftFromAsset({
      asset: {
        id: 'asset-1',
        name: 'orders',
        kind: 'model',
        fieldCount: 0,
        fields: [],
      } as any,
      buildDraftFromAsset,
      createFromAssetSuccessMessage: 'created',
      onCreateDraftFromAsset,
      openEditor,
      showSuccess,
    });

    expect(openEditor).toHaveBeenCalledWith({
      contextAssetId: 'asset-1',
      draftValues: { description: 'orders' },
    });
    expect(showSuccess).toHaveBeenCalledWith('created');
    expect(onCreateDraftFromAsset).toHaveBeenCalled();
  });

  it('duplicates an item and skips success feedback when openEditor rejects the open', async () => {
    const openEditor = jest.fn(async () => false);
    const showSuccess = jest.fn();

    await runKnowledgeWorkbenchDuplicateEntry({
      item: { id: 'item-2', name: 'Revenue' },
      buildDuplicateDraft: jest.fn((item) => ({
        description: `${item.name} copy`,
      })),
      duplicateSuccessMessage: 'duplicated',
      openEditor,
      showSuccess,
    });

    expect(openEditor).toHaveBeenCalledWith({
      draftValues: { description: 'Revenue copy' },
    });
    expect(showSuccess).not.toHaveBeenCalled();
  });

  it('clears the active draft only when deleting the currently edited item', async () => {
    const clearActiveEditorDraft = jest.fn();
    const confirmDeleteEntry = jest.fn(async () => true);
    const getItemId = jest.fn((item) => item.id);
    const onDeleteItem = jest.fn(async () => undefined);

    await runKnowledgeWorkbenchDeleteEntry({
      item: { id: 'item-1', name: 'Revenue' },
      clearActiveEditorDraft,
      confirmDeleteEntry,
      editingItemId: 'item-1',
      entityLabel: 'SQL 模板',
      getItemId,
      onDeleteItem,
    });

    expect(confirmDeleteEntry).toHaveBeenCalledWith('SQL 模板');
    expect(onDeleteItem).toHaveBeenCalledWith({
      id: 'item-1',
      name: 'Revenue',
    });
    expect(clearActiveEditorDraft).toHaveBeenCalled();
  });
});
