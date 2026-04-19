import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useSkillConnectors, {
  buildSkillConnectorsRequestKey,
} from './useSkillConnectors';

const mockUseRestRequest = jest.fn();

jest.mock('@/hooks/useRestRequest', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseRestRequest(...args),
}));

describe('useSkillConnectors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRestRequest.mockReturnValue({
      data: [
        {
          id: 'connector-1',
          workspaceId: 'workspace-1',
          type: 'postgres',
          displayName: 'Warehouse',
        },
      ],
      loading: false,
    });
  });

  it('builds a connector request key from canonical runtime scope fields', () => {
    expect(
      buildSkillConnectorsRequestKey({
        enabled: true,
        runtimeScopeSelector: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
          runtimeScopeId: 'scope-1',
        },
      }),
    ).toBe(
      '/api/v1/connectors?workspaceId=workspace-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );

    expect(
      buildSkillConnectorsRequestKey({
        enabled: false,
        runtimeScopeSelector: { workspaceId: 'workspace-1' },
      }),
    ).toBeNull();
  });

  it('passes the derived request key into useRestRequest', () => {
    const onError = jest.fn();

    const Harness = () => {
      useSkillConnectors({
        enabled: true,
        runtimeScopeSelector: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
        onError,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        initialData: [],
        requestKey:
          '/api/v1/connectors?workspaceId=workspace-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
        onError,
      }),
    );
  });

  it('returns connectors and loading state from the shared request hook', () => {
    let current: ReturnType<typeof useSkillConnectors> | null = null;

    const Harness = () => {
      current = useSkillConnectors({
        enabled: true,
        runtimeScopeSelector: { workspaceId: 'workspace-1' },
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    expect(current).toEqual({
      connectors: [
        {
          id: 'connector-1',
          workspaceId: 'workspace-1',
          type: 'postgres',
          displayName: 'Warehouse',
        },
      ],
      loading: false,
    });
  });
});
