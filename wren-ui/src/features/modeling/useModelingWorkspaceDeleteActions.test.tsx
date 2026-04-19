import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { message } from 'antd';
import { NODE_TYPE } from '@/utils/enum';
import { deleteViewById } from '@/utils/viewRest';
import {
  deleteCalculatedField,
  deleteModel,
  deleteRelationship,
} from '@/utils/modelingRest';
import type { RunDiagramMutation } from './modelingWorkspaceMutationTypes';
import useModelingWorkspaceDeleteActions from './useModelingWorkspaceDeleteActions';

jest.mock('antd', () => ({
  message: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/utils/viewRest', () => ({
  deleteViewById: jest.fn(),
}));

jest.mock('@/utils/modelingRest', () => ({
  deleteModel: jest.fn(),
  deleteCalculatedField: jest.fn(),
  deleteRelationship: jest.fn(),
}));

describe('useModelingWorkspaceDeleteActions', () => {
  const runtimeSelector = {
    workspaceId: 'workspace-1',
    runtimeScopeId: 'scope-1',
    knowledgeBaseId: 'kb-1',
    kbSnapshotId: 'snap-1',
    deployHash: 'deploy-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (deleteViewById as jest.Mock).mockResolvedValue(undefined);
    (deleteModel as jest.Mock).mockResolvedValue(undefined);
    (deleteCalculatedField as jest.Mock).mockResolvedValue(undefined);
    (deleteRelationship as jest.Mock).mockResolvedValue(undefined);
  });

  const createRunDiagramMutation = () =>
    jest.fn(async (_setLoadingState, action) => {
      await action();
    }) as RunDiagramMutation;

  const setupDeleteActions = ({
    runDiagramMutation,
    refetchDiagram,
    refetchDeployStatus,
  }: {
    runDiagramMutation: RunDiagramMutation;
    refetchDiagram: jest.Mock;
    refetchDeployStatus: jest.Mock;
  }): ReturnType<typeof useModelingWorkspaceDeleteActions> => {
    let current: ReturnType<typeof useModelingWorkspaceDeleteActions> | null =
      null;

    const Harness = () => {
      current = useModelingWorkspaceDeleteActions({
        runDiagramMutation,
        refetchDiagram,
        refetchDeployStatus,
        runtimeSelector,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize delete actions hook');
    }

    return current as ReturnType<typeof useModelingWorkspaceDeleteActions>;
  };

  it('deletes models through runDiagramMutation', async () => {
    const refetchDiagram = jest.fn().mockResolvedValue(undefined);
    const refetchDeployStatus = jest.fn().mockResolvedValue(undefined);
    const runDiagramMutation = createRunDiagramMutation();

    const deleteActions = setupDeleteActions({
      runDiagramMutation,
      refetchDiagram,
      refetchDeployStatus,
    });

    await deleteActions.handleDeleteNode(NODE_TYPE.MODEL, {
      modelId: '42',
    });

    expect(runDiagramMutation).toHaveBeenCalledTimes(1);
    expect(deleteModel).toHaveBeenCalledWith(runtimeSelector, 42);
    expect(message.success).toHaveBeenCalledWith('已成功删除模型。');
    expect(refetchDiagram).not.toHaveBeenCalled();
    expect(refetchDeployStatus).not.toHaveBeenCalled();
  });

  it('deletes views and refreshes diagram state', async () => {
    const refetchDiagram = jest.fn().mockResolvedValue(undefined);
    const refetchDeployStatus = jest.fn().mockResolvedValue(undefined);
    const runDiagramMutation = createRunDiagramMutation();

    const deleteActions = setupDeleteActions({
      runDiagramMutation,
      refetchDiagram,
      refetchDeployStatus,
    });

    await deleteActions.handleDeleteNode(NODE_TYPE.VIEW, { viewId: '12' });

    expect(deleteViewById).toHaveBeenCalledWith(runtimeSelector, 12);
    expect(refetchDiagram).toHaveBeenCalledTimes(1);
    expect(refetchDeployStatus).toHaveBeenCalledTimes(1);
    expect(message.success).toHaveBeenCalledWith('已成功删除视图。');
    expect(runDiagramMutation).not.toHaveBeenCalled();
  });

  it('ignores malformed payloads without mutating anything', async () => {
    const refetchDiagram = jest.fn().mockResolvedValue(undefined);
    const refetchDeployStatus = jest.fn().mockResolvedValue(undefined);
    const runDiagramMutation = createRunDiagramMutation();

    const deleteActions = setupDeleteActions({
      runDiagramMutation,
      refetchDiagram,
      refetchDeployStatus,
    });

    await deleteActions.handleDeleteNode(NODE_TYPE.RELATION, {
      relationId: 'oops',
    });

    expect(deleteRelationship).not.toHaveBeenCalled();
    expect(runDiagramMutation).not.toHaveBeenCalled();
    expect(message.success).not.toHaveBeenCalled();
  });
});
