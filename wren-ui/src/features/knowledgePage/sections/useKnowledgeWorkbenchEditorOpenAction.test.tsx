import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useKnowledgeWorkbenchEditorOpenAction } from './useKnowledgeWorkbenchEditorOpenAction';

describe('useKnowledgeWorkbenchEditorOpenAction', () => {
  const renderHarness = (
    props: Partial<
      Parameters<typeof useKnowledgeWorkbenchEditorOpenAction<any, any>>[0]
    > = {},
  ) => {
    let current: ReturnType<
      typeof useKnowledgeWorkbenchEditorOpenAction<any, any>
    > | null = null;

    const resolvedProps = {
      activeWorkbenchSection: 'sqlTemplates' as const,
      targetSection: 'sqlTemplates' as const,
      currentEditingId: 'sql-1',
      drawerOpen: false,
      currentSectionDirty: false,
      counterpartSectionDirty: false,
      onChangeWorkbenchSection: jest.fn(),
      onOpenDetail: jest.fn(),
      form: { setFieldsValue: jest.fn() },
      syncDraftBaseline: jest.fn(),
      setContextAssetId: jest.fn(),
      setDrawerOpen: jest.fn(),
      buildEditorValues: jest.fn(({ item, draftValues }) => ({
        id: item?.id,
        ...draftValues,
      })),
      runWithDirtyGuard: jest.fn(async (_dirty, action) => {
        await action();
        return true;
      }),
      ...props,
    };

    const Harness = () => {
      current = useKnowledgeWorkbenchEditorOpenAction(resolvedProps);
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error(
        'Failed to initialize useKnowledgeWorkbenchEditorOpenAction',
      );
    }

    return {
      hook: current as ReturnType<
        typeof useKnowledgeWorkbenchEditorOpenAction<any, any>
      >,
      props: resolvedProps,
    };
  };

  it('opens the target editor and applies built values through the dirty guard', async () => {
    const { hook, props } = renderHarness({
      drawerOpen: false,
      currentEditingId: null,
    });

    await hook({
      item: { id: 'sql-2' },
      draftValues: { description: 'Revenue' },
      contextAssetId: 'asset-1',
    });

    expect(props.runWithDirtyGuard).toHaveBeenCalledWith(
      false,
      expect.any(Function),
    );
    expect(props.onOpenDetail).toHaveBeenCalledWith({ id: 'sql-2' });
    expect(props.form.setFieldsValue).toHaveBeenCalledWith({
      description: 'Revenue',
      id: 'sql-2',
    });
    expect(props.syncDraftBaseline).toHaveBeenCalledWith({
      description: 'Revenue',
      id: 'sql-2',
    });
    expect(props.setContextAssetId).toHaveBeenCalledWith('asset-1');
    expect(props.setDrawerOpen).toHaveBeenCalledWith(true);
  });

  it('switches sections before opening when needed', async () => {
    const { hook, props } = renderHarness({
      activeWorkbenchSection: 'instructions',
      targetSection: 'sqlTemplates',
      counterpartSectionDirty: true,
    });

    await hook({
      item: { id: 'sql-2' },
    });

    expect(props.runWithDirtyGuard).toHaveBeenCalledWith(
      true,
      expect.any(Function),
    );
    expect(props.onChangeWorkbenchSection).toHaveBeenCalledWith('sqlTemplates');
  });

  it('only ensures the drawer stays open when re-opening the same editor', async () => {
    const { hook, props } = renderHarness({
      drawerOpen: true,
    });

    await hook({
      item: { id: 'sql-1' },
      switchSection: false,
    });

    expect(props.runWithDirtyGuard).not.toHaveBeenCalled();
    expect(props.setDrawerOpen).toHaveBeenCalledWith(true);
    expect(props.form.setFieldsValue).not.toHaveBeenCalled();
  });
});
