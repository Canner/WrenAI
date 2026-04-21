import {
  runInitialModelingWorkspaceLoad,
  runModelingWorkspaceRefresh,
} from './useModelingWorkspaceState';

describe('useModelingWorkspaceState helpers', () => {
  it('loads the initial modeling diagram without refetching deploy status', async () => {
    const fitView = jest.fn();
    const diagramRef = {
      current: {
        fitView,
      },
    } as any;
    const refetchDiagram = jest.fn().mockResolvedValue({
      diagram: { models: [], views: [] },
    });

    const result = await runInitialModelingWorkspaceLoad({
      diagramRef,
      refetchDiagram,
    });

    expect(refetchDiagram).toHaveBeenCalledTimes(1);
    expect(fitView).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      diagram: { models: [], views: [] },
    });
  });

  it('keeps manual modeling refresh wired to both diagram and deploy status', async () => {
    const fitView = jest.fn();
    const diagramRef = {
      current: {
        fitView,
      },
    } as any;
    const refetchDiagram = jest.fn().mockResolvedValue({
      diagram: { models: [], views: [] },
    });
    const refetchDeployStatus = jest.fn().mockResolvedValue({
      data: {
        modelSync: {
          status: 'SYNCRONIZED',
        },
      },
    });

    const result = await runModelingWorkspaceRefresh({
      diagramRef,
      fitView: true,
      refetchDeployStatus,
      refetchDiagram,
    });

    expect(refetchDiagram).toHaveBeenCalledTimes(1);
    expect(refetchDeployStatus).toHaveBeenCalledTimes(1);
    expect(fitView).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      diagram: { models: [], views: [] },
    });
  });
});
