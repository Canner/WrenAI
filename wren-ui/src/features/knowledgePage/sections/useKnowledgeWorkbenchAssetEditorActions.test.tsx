import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useKnowledgeWorkbenchAssetEditorActions } from './useKnowledgeWorkbenchAssetEditorActions';

const mockLifecycle = jest.fn();
const mockOpenAction = jest.fn();
const mockEntryActions = jest.fn();

jest.mock('./useKnowledgeWorkbenchAssetEditorLifecycle', () => ({
  useKnowledgeWorkbenchAssetEditorLifecycle: (...args: any[]) =>
    mockLifecycle(...args),
}));

jest.mock('./useKnowledgeWorkbenchEditorOpenAction', () => ({
  useKnowledgeWorkbenchEditorOpenAction: (...args: any[]) =>
    mockOpenAction(...args),
}));

jest.mock('./useKnowledgeWorkbenchEditorEntryActions', () => ({
  useKnowledgeWorkbenchEditorEntryActions: (...args: any[]) =>
    mockEntryActions(...args),
}));

describe('useKnowledgeWorkbenchAssetEditorActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLifecycle.mockReturnValue({
      applyContextDraft: jest.fn(),
      clearActiveEditorDraft: jest.fn(),
      handleCloseDrawer: jest.fn(async () => true),
      handleResetEditor: jest.fn(),
      handleSubmitDetail: jest.fn(async () => undefined),
    });
    mockOpenAction.mockReturnValue(jest.fn(async () => true));
    mockEntryActions.mockReturnValue({
      handleCreateFromAsset: jest.fn(async () => undefined),
      handleDeleteItem: jest.fn(async () => undefined),
      handleDuplicateItem: jest.fn(async () => undefined),
    });
  });

  const renderHarness = () => {
    let current: ReturnType<
      typeof useKnowledgeWorkbenchAssetEditorActions<any, any>
    > | null = null;

    const args = {
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
      contextAssetId: 'asset-1',
      createFromAssetSuccessMessage: 'created',
      currentEditingId: 'sql-1',
      currentSectionDirty: true,
      counterpartSectionDirty: false,
      drawerOpen: false,
      duplicateSuccessMessage: 'duplicated',
      editingItemId: 'sql-1',
      emptyValues: { description: '' },
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
    };

    const Harness = () => {
      current = useKnowledgeWorkbenchAssetEditorActions(args);
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error(
        'Failed to initialize useKnowledgeWorkbenchAssetEditorActions',
      );
    }

    return { current, args };
  };

  it('pipes shared args into lifecycle/open/entry hooks and returns the composed result', () => {
    const { current, args } = renderHarness();

    expect(mockLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        applySuccessMessage: 'applied',
        contextAsset: { id: 'asset-1' },
        isDraftDirty: true,
      }),
    );
    expect(mockOpenAction).toHaveBeenCalledWith(
      expect.objectContaining({
        activeWorkbenchSection: 'sqlTemplates',
        targetSection: 'sqlTemplates',
        currentEditingId: 'sql-1',
      }),
    );
    expect(mockEntryActions).toHaveBeenCalledWith(
      expect.objectContaining({
        buildDraftFromAsset: args.buildDraftFromAsset,
        buildDuplicateDraft: args.buildDuplicateDraft,
        entityLabel: 'SQL 模板',
        openEditor: expect.any(Function),
      }),
    );
    expect(current).toMatchObject({
      applyContextDraft: expect.any(Function),
      contextAssetId: 'asset-1',
      handleCloseDrawer: expect.any(Function),
      handleCreateFromAsset: expect.any(Function),
      handleDeleteItem: expect.any(Function),
      handleDuplicateItem: expect.any(Function),
      handleResetEditor: expect.any(Function),
      handleSubmitDetail: expect.any(Function),
      openEditor: expect.any(Function),
    });
  });
});
