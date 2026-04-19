import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { message } from 'antd';
import { useKnowledgeWorkbenchRuleActions } from './useKnowledgeWorkbenchRuleActions';

jest.mock('antd', () => ({
  message: {
    success: jest.fn(),
  },
}));

describe('useKnowledgeWorkbenchRuleActions', () => {
  const mockMessageSuccess = message.success as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderHarness = (
    props: Partial<Parameters<typeof useKnowledgeWorkbenchRuleActions>[0]> = {},
  ) => {
    let current: ReturnType<typeof useKnowledgeWorkbenchRuleActions> | null =
      null;

    const resolvedProps = {
      activeWorkbenchSection: 'instructions' as const,
      editingInstruction: {
        createdAt: '2026-04-18T00:00:00.000Z',
        id: 2,
        instruction: 'Use finance tone',
        isDefault: false,
        questions: [],
        updatedAt: '2026-04-18T00:00:00.000Z',
      },
      isRuleDraftDirty: false,
      isSqlDraftDirty: false,
      onChangeWorkbenchSection: jest.fn(),
      onCreateRuleDraftFromAsset: jest.fn(),
      onDeleteRule: jest.fn().mockResolvedValue(undefined),
      onOpenRuleDetail: jest.fn(),
      onResetRuleDetailEditor: jest.fn(),
      onSubmitRuleDetail: jest.fn().mockResolvedValue(undefined),
      ruleDrawerOpen: true,
      ruleForm: { setFieldsValue: jest.fn() },
      syncRuleDraftBaseline: jest.fn(),
      setRuleContextAssetId: jest.fn(),
      setRuleDrawerOpen: jest.fn(),
      ruleContextAsset: null,
      runWithDirtyGuard: jest.fn(async (_dirty, action) => {
        await action();
        return true;
      }),
      confirmDeleteEntry: jest.fn().mockResolvedValue(true),
      ...props,
    };

    const Harness = () => {
      current = useKnowledgeWorkbenchRuleActions(resolvedProps);
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize useKnowledgeWorkbenchRuleActions');
    }

    return {
      hook: current as ReturnType<typeof useKnowledgeWorkbenchRuleActions>,
      props: resolvedProps,
    };
  };

  it('creates a rule draft from an asset and opens the drawer context', async () => {
    const { hook, props } = renderHarness({
      ruleDrawerOpen: false,
      editingInstruction: null,
    });

    await hook.handleCreateRuleFromAsset({
      id: 'asset-2',
      name: 'customers',
      kind: 'model',
      fieldCount: 1,
      fields: [],
    });

    expect(props.onOpenRuleDetail).toHaveBeenCalledWith(undefined);
    expect(props.setRuleContextAssetId).toHaveBeenCalledWith('asset-2');
    expect(props.setRuleDrawerOpen).toHaveBeenCalledWith(true);
    expect(props.onCreateRuleDraftFromAsset).toHaveBeenCalled();
    expect(mockMessageSuccess).toHaveBeenCalledWith(
      '已带入资产上下文，可继续完善分析规则。',
    );
  });

  it('resets active draft state when deleting the currently edited rule', async () => {
    const { hook, props } = renderHarness();

    await hook.handleDeleteRule({
      createdAt: '2026-04-18T00:00:00.000Z',
      id: 2,
      instruction: 'Use finance tone',
      isDefault: false,
      questions: [],
      updatedAt: '2026-04-18T00:00:00.000Z',
    } as any);

    expect(props.onDeleteRule).toHaveBeenCalled();
    expect(props.onResetRuleDetailEditor).toHaveBeenCalled();
    expect(props.setRuleContextAssetId).toHaveBeenCalledWith(undefined);
    expect(props.setRuleDrawerOpen).toHaveBeenCalledWith(false);
  });
});
