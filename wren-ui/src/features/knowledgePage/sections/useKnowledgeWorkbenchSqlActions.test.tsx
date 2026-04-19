import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { message } from 'antd';
import { useKnowledgeWorkbenchSqlActions } from './useKnowledgeWorkbenchSqlActions';

jest.mock('antd', () => ({
  message: {
    success: jest.fn(),
  },
}));

describe('useKnowledgeWorkbenchSqlActions', () => {
  const mockMessageSuccess = message.success as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderHarness = (
    props: Partial<Parameters<typeof useKnowledgeWorkbenchSqlActions>[0]> = {},
  ) => {
    let current: ReturnType<typeof useKnowledgeWorkbenchSqlActions> | null =
      null;

    const resolvedProps = {
      activeWorkbenchSection: 'sqlTemplates' as const,
      editingSqlPair: { id: 1, question: 'Revenue', sql: 'select 1' },
      isRuleDraftDirty: false,
      isSqlDraftDirty: false,
      onChangeWorkbenchSection: jest.fn(),
      onCreateSqlTemplateDraftFromAsset: jest.fn(),
      onDeleteSqlTemplate: jest.fn().mockResolvedValue(undefined),
      onOpenSqlTemplateDetail: jest.fn(),
      onResetSqlTemplateEditor: jest.fn(),
      onSubmitSqlTemplateDetail: jest.fn().mockResolvedValue(undefined),
      sqlTemplateForm: { setFieldsValue: jest.fn() },
      sqlTemplateDrawerOpen: true,
      syncSqlDraftBaseline: jest.fn(),
      setSqlContextAssetId: jest.fn(),
      setSqlTemplateDrawerOpen: jest.fn(),
      sqlContextAsset: null,
      runWithDirtyGuard: jest.fn(async (_dirty, action) => {
        await action();
        return true;
      }),
      confirmDeleteEntry: jest.fn().mockResolvedValue(true),
      ...props,
    };

    const Harness = () => {
      current = useKnowledgeWorkbenchSqlActions(resolvedProps);
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize useKnowledgeWorkbenchSqlActions');
    }

    return {
      hook: current as ReturnType<typeof useKnowledgeWorkbenchSqlActions>,
      props: resolvedProps,
    };
  };

  it('creates a SQL template draft from an asset and opens the drawer context', async () => {
    const { hook, props } = renderHarness({
      sqlTemplateDrawerOpen: false,
      editingSqlPair: null,
      runWithDirtyGuard: jest.fn(async (_dirty, action) => {
        await action();
        return true;
      }),
    });

    await hook.handleCreateSqlTemplateFromAsset({
      id: 'asset-1',
      name: 'orders',
      kind: 'model',
      fieldCount: 2,
      fields: [],
    });

    expect(props.onOpenSqlTemplateDetail).toHaveBeenCalledWith(undefined);
    expect(props.setSqlContextAssetId).toHaveBeenCalledWith('asset-1');
    expect(props.setSqlTemplateDrawerOpen).toHaveBeenCalledWith(true);
    expect(props.onCreateSqlTemplateDraftFromAsset).toHaveBeenCalled();
    expect(mockMessageSuccess).toHaveBeenCalledWith(
      '已带入资产上下文，可继续完善 SQL 模板。',
    );
  });

  it('resets active draft state when deleting the currently edited SQL template', async () => {
    const { hook, props } = renderHarness();

    await hook.handleDeleteSqlTemplate({
      id: 1,
      question: 'Revenue',
      sql: 'select 1',
    } as any);

    expect(props.onDeleteSqlTemplate).toHaveBeenCalled();
    expect(props.onResetSqlTemplateEditor).toHaveBeenCalled();
    expect(props.setSqlContextAssetId).toHaveBeenCalledWith(undefined);
    expect(props.setSqlTemplateDrawerOpen).toHaveBeenCalledWith(false);
  });
});
