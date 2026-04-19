import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { message } from 'antd';
import { useKnowledgeWorkbenchAssetEditorLifecycle } from './useKnowledgeWorkbenchAssetEditorLifecycle';

jest.mock('antd', () => ({
  message: {
    success: jest.fn(),
  },
}));

describe('useKnowledgeWorkbenchAssetEditorLifecycle', () => {
  const mockMessageSuccess = message.success as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderHarness = (
    props: Partial<
      Parameters<typeof useKnowledgeWorkbenchAssetEditorLifecycle>[0]
    > = {},
  ) => {
    let current: ReturnType<
      typeof useKnowledgeWorkbenchAssetEditorLifecycle
    > | null = null;

    const resolvedProps = {
      applySuccessMessage: '已带入上下文',
      buildDraftFromAsset: jest.fn((asset) => ({ description: asset.name })),
      contextAsset: null,
      emptyValues: { description: '' },
      form: { setFieldsValue: jest.fn() },
      isDraftDirty: false,
      onResetEditor: jest.fn(),
      onSubmitDetail: jest.fn().mockResolvedValue(undefined),
      runWithDirtyGuard: jest.fn(async (_dirty, action) => {
        await action();
        return true;
      }),
      setContextAssetId: jest.fn(),
      setDrawerOpen: jest.fn(),
      syncDraftBaseline: jest.fn(),
      ...props,
    };

    const Harness = () => {
      current = useKnowledgeWorkbenchAssetEditorLifecycle(resolvedProps);
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error(
        'Failed to initialize useKnowledgeWorkbenchAssetEditorLifecycle',
      );
    }

    return {
      hook: current as ReturnType<
        typeof useKnowledgeWorkbenchAssetEditorLifecycle
      >,
      props: resolvedProps,
    };
  };

  it('applies context draft values when a reference asset is present', () => {
    const { hook, props } = renderHarness({
      contextAsset: {
        id: 'asset-1',
        name: 'orders',
        kind: 'model',
        fieldCount: 1,
        fields: [],
      },
    });

    hook.applyContextDraft();

    expect(props.buildDraftFromAsset).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'asset-1' }),
    );
    expect(props.form.setFieldsValue).toHaveBeenCalledWith({
      description: 'orders',
    });
    expect(mockMessageSuccess).toHaveBeenCalledWith('已带入上下文');
  });

  it('resets and clears the active editor draft when asked explicitly', () => {
    const { hook, props } = renderHarness();

    hook.clearActiveEditorDraft();

    expect(props.onResetEditor).toHaveBeenCalled();
    expect(props.syncDraftBaseline).toHaveBeenCalledWith({
      description: '',
    });
    expect(props.setContextAssetId).toHaveBeenCalledWith(undefined);
    expect(props.setDrawerOpen).toHaveBeenCalledWith(false);
  });

  it('closes the drawer through the dirty guard and re-syncs baseline on submit', async () => {
    const { hook, props } = renderHarness({
      isDraftDirty: true,
    });

    await hook.handleCloseDrawer();
    await hook.handleSubmitDetail();

    expect(props.runWithDirtyGuard).toHaveBeenCalledWith(
      true,
      expect.any(Function),
    );
    expect(props.onSubmitDetail).toHaveBeenCalled();
    expect(props.syncDraftBaseline).toHaveBeenLastCalledWith();
  });
});
