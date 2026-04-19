import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { message } from 'antd';
import { useKnowledgeWorkbenchEditorEntryActions } from './useKnowledgeWorkbenchEditorEntryActions';

jest.mock('antd', () => ({
  message: {
    success: jest.fn(),
  },
}));

describe('useKnowledgeWorkbenchEditorEntryActions', () => {
  const mockMessageSuccess = message.success as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderHarness = () => {
    let current: ReturnType<
      typeof useKnowledgeWorkbenchEditorEntryActions<any, any>
    > | null = null;

    const props = {
      buildDraftFromAsset: jest.fn((asset) => ({
        description: asset.name,
      })),
      buildDuplicateDraft: jest.fn((item) => ({
        description: `${item.name} copy`,
      })),
      clearActiveEditorDraft: jest.fn(),
      confirmDeleteEntry: jest.fn().mockResolvedValue(true),
      createFromAssetSuccessMessage: '已带入资产上下文',
      duplicateSuccessMessage: '已生成副本',
      editingItemId: 'item-1',
      entityLabel: 'SQL 模板',
      getItemId: jest.fn((item) => item.id),
      onCreateDraftFromAsset: jest.fn(),
      onDeleteItem: jest.fn().mockResolvedValue(undefined),
      openEditor: jest.fn().mockResolvedValue(true),
    };

    const Harness = () => {
      current = useKnowledgeWorkbenchEditorEntryActions(props);
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error(
        'Failed to initialize useKnowledgeWorkbenchEditorEntryActions',
      );
    }

    return {
      hook: current as ReturnType<
        typeof useKnowledgeWorkbenchEditorEntryActions<any, any>
      >,
      props,
    };
  };

  it('creates a draft from asset and reports success', async () => {
    const { hook, props } = renderHarness();

    await hook.handleCreateFromAsset({
      id: 'asset-1',
      name: 'orders',
      kind: 'model',
      fieldCount: 1,
      fields: [],
    });

    expect(props.openEditor).toHaveBeenCalledWith({
      contextAssetId: 'asset-1',
      draftValues: {
        description: 'orders',
      },
    });
    expect(props.onCreateDraftFromAsset).toHaveBeenCalled();
    expect(mockMessageSuccess).toHaveBeenCalledWith('已带入资产上下文');
  });

  it('duplicates an item and reports success', async () => {
    const { hook, props } = renderHarness();

    await hook.handleDuplicateItem({
      id: 'item-2',
      name: 'Revenue',
    });

    expect(props.openEditor).toHaveBeenCalledWith({
      draftValues: {
        description: 'Revenue copy',
      },
    });
    expect(mockMessageSuccess).toHaveBeenCalledWith('已生成副本');
  });

  it('clears the active draft after deleting the currently edited item', async () => {
    const { hook, props } = renderHarness();

    await hook.handleDeleteItem({
      id: 'item-1',
      name: 'Revenue',
    });

    expect(props.confirmDeleteEntry).toHaveBeenCalledWith('SQL 模板');
    expect(props.onDeleteItem).toHaveBeenCalledWith({
      id: 'item-1',
      name: 'Revenue',
    });
    expect(props.clearActiveEditorDraft).toHaveBeenCalled();
  });
});
