import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useSkillsControlPlaneData, {
  buildSkillsControlPlaneRequestKey,
} from './useSkillsControlPlaneData';

const mockUseRestRequest = jest.fn();

jest.mock('./useRestRequest', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseRestRequest(...args),
}));

describe('useSkillsControlPlaneData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRestRequest.mockReturnValue({
      data: {
        marketplaceCatalogSkills: [],
        skillDefinitions: [],
      },
      loading: false,
      refetch: jest.fn(),
    });
  });

  it('builds a stable request key from canonical runtime selector fields', () => {
    expect(
      buildSkillsControlPlaneRequestKey({
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
      JSON.stringify({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        runtimeScopeId: 'scope-1',
      }),
    );

    expect(
      buildSkillsControlPlaneRequestKey({
        enabled: false,
        runtimeScopeSelector: { workspaceId: 'workspace-1' },
      }),
    ).toBeNull();
  });

  it('passes the derived request key into useRestRequest', () => {
    const onError = jest.fn();

    const Harness = () => {
      useSkillsControlPlaneData({
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
        initialData: {
          marketplaceCatalogSkills: [],
          skillDefinitions: [],
        },
        requestKey: JSON.stringify({
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
          runtimeScopeId: null,
        }),
        onError,
      }),
    );
  });
});
