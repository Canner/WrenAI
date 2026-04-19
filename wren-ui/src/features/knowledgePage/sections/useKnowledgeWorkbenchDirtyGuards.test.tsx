import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Modal } from 'antd';
import { useKnowledgeWorkbenchDirtyGuards } from './useKnowledgeWorkbenchDirtyGuards';

jest.mock('antd', () => ({
  Modal: {
    confirm: jest.fn(),
  },
}));

describe('useKnowledgeWorkbenchDirtyGuards', () => {
  const mockConfirm = Modal.confirm as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderHarness = () => {
    let current: ReturnType<typeof useKnowledgeWorkbenchDirtyGuards> | null =
      null;

    const Harness = () => {
      current = useKnowledgeWorkbenchDirtyGuards();
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize useKnowledgeWorkbenchDirtyGuards');
    }

    return current as ReturnType<typeof useKnowledgeWorkbenchDirtyGuards>;
  };

  it('runs actions immediately when dirty guard is not needed', async () => {
    const guards = renderHarness();
    const action = jest.fn();

    await expect(guards.runWithDirtyGuard(false, action)).resolves.toBe(true);

    expect(action).toHaveBeenCalledTimes(1);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('stops the guarded action when the discard confirmation is cancelled', async () => {
    mockConfirm.mockImplementation(({ onCancel }) => {
      onCancel?.();
    });
    const guards = renderHarness();
    const action = jest.fn();

    await expect(guards.runWithDirtyGuard(true, action)).resolves.toBe(false);

    expect(action).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: '当前编辑尚未保存' }),
    );
  });

  it('confirms delete actions with the target entity label', async () => {
    mockConfirm.mockImplementation(({ onOk }) => {
      onOk?.();
    });
    const guards = renderHarness();

    await expect(guards.confirmDeleteEntry('SQL 模板')).resolves.toBe(true);

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '删除SQL 模板',
        okButtonProps: { danger: true },
      }),
    );
  });
});
