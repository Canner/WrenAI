import { RuntimeScopeResolver } from '../runtimeScope';

const createRequest = (overrides: Partial<any> = {}) =>
  ({
    headers: {},
    body: {},
    query: {},
    ...overrides,
  }) as any;

describe('RuntimeScopeResolver', () => {
  let projectRepository: any;
  let deployRepository: any;
  let deployService: any;
  let authService: any;
  let workspaceRepository: any;
  let knowledgeBaseRepository: any;
  let kbSnapshotRepository: any;
  let resolver: RuntimeScopeResolver;

  beforeEach(() => {
    projectRepository = {
      getCurrentProject: jest.fn(),
      findOneBy: jest.fn(),
    };
    deployRepository = {
      findOneBy: jest.fn(),
    };
    deployService = {
      getLastDeployment: jest.fn(),
    };
    authService = {
      validateSession: jest.fn(),
    };
    workspaceRepository = {
      findOneBy: jest.fn(),
    };
    knowledgeBaseRepository = {
      findOneBy: jest.fn(),
    };
    kbSnapshotRepository = {
      findOneBy: jest.fn(),
    };

    resolver = new RuntimeScopeResolver({
      projectRepository,
      deployRepository,
      deployService,
      authService,
      workspaceRepository,
      knowledgeBaseRepository,
      kbSnapshotRepository,
    });
  });

  it('resolves explicit runtime scope via kb_snapshot bridge', async () => {
    kbSnapshotRepository.findOneBy.mockResolvedValueOnce({
      id: 'snap-1',
      knowledgeBaseId: 'kb-1',
      deployHash: 'deploy-1',
      legacyProjectId: 101,
    });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-1',
      workspaceId: 'ws-1',
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'ws-1',
      status: 'active',
    });
    projectRepository.findOneBy.mockResolvedValue({
      id: 101,
      language: 'EN',
      type: 'POSTGRES',
    });
    deployRepository.findOneBy.mockResolvedValue({
      id: 1,
      projectId: 101,
      hash: 'deploy-1',
      manifest: {},
    });

    const result = await resolver.resolveRequestScope(
      createRequest({
        body: {
          kbSnapshotId: 'snap-1',
        },
      }),
    );

    expect(result.source).toBe('explicit-request');
    expect(result.project.id).toBe(101);
    expect(result.deployHash).toBe('deploy-1');
    expect(result.selector.workspaceId).toBe('ws-1');
    expect(result.selector.knowledgeBaseId).toBe('kb-1');
    expect(result.selector.kbSnapshotId).toBe('snap-1');
  });

  it('reads explicit selector from graphql variables payload', async () => {
    kbSnapshotRepository.findOneBy.mockResolvedValueOnce({
      id: 'snap-vars',
      knowledgeBaseId: 'kb-vars',
      deployHash: 'deploy-vars',
      legacyProjectId: 301,
    });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-vars',
      workspaceId: 'ws-vars',
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'ws-vars',
      status: 'active',
    });
    projectRepository.findOneBy.mockResolvedValue({
      id: 301,
      language: 'EN',
      type: 'POSTGRES',
    });
    deployRepository.findOneBy.mockResolvedValue({
      id: 31,
      projectId: 301,
      hash: 'deploy-vars',
      manifest: {},
    });

    const result = await resolver.resolveRequestScope(
      createRequest({
        body: {
          operationName: 'Dashboard',
          variables: {
            kbSnapshotId: 'snap-vars',
          },
          query: 'query Dashboard { dashboard { id } }',
        },
      }),
    );

    expect(result.source).toBe('explicit-request');
    expect(result.project.id).toBe(301);
    expect(result.selector.kbSnapshotId).toBe('snap-vars');
  });

  it('falls back to legacy project shim when request scope is absent', async () => {
    projectRepository.getCurrentProject.mockResolvedValue({
      id: 7,
      language: 'EN',
      type: 'POSTGRES',
    });
    deployService.getLastDeployment.mockResolvedValue({
      id: 11,
      projectId: 7,
      hash: 'deploy-7',
      manifest: {},
    });
    kbSnapshotRepository.findOneBy.mockResolvedValue({
      id: 'snap-7',
      knowledgeBaseId: 'kb-7',
      deployHash: 'deploy-7',
      legacyProjectId: 7,
    });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-7',
      workspaceId: 'ws-7',
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'ws-7',
      status: 'active',
    });

    const result = await resolver.resolveRequestScope(createRequest(), {
      allowLegacyProjectShim: true,
    });

    expect(result.source).toBe('legacy-project-shim');
    expect(projectRepository.getCurrentProject).toHaveBeenCalledTimes(1);
    expect(result.deployHash).toBe('deploy-7');
    expect(result.selector.kbSnapshotId).toBe('snap-7');
  });

  it('keeps legacy project shim available before the first deployment', async () => {
    projectRepository.getCurrentProject.mockResolvedValue({
      id: 17,
      language: 'EN',
      type: 'POSTGRES',
    });
    deployService.getLastDeployment.mockResolvedValue(null);
    kbSnapshotRepository.findOneBy.mockResolvedValue(null);

    const result = await resolver.resolveRequestScope(createRequest(), {
      allowLegacyProjectShim: true,
    });

    expect(result.source).toBe('legacy-project-shim');
    expect(result.project.id).toBe(17);
    expect(result.deployment).toBeNull();
    expect(result.deployHash).toBeNull();
  });

  it('requires an explicit selector when legacy shim is not allowed', async () => {
    await expect(resolver.resolveRequestScope(createRequest())).rejects.toThrow(
      'Runtime scope selector is required for this request',
    );

    expect(projectRepository.getCurrentProject).not.toHaveBeenCalled();
  });

  it('resolves an explicit legacy project selector without workspace or deployment', async () => {
    projectRepository.findOneBy.mockResolvedValue({
      id: 501,
      language: 'EN',
      type: 'POSTGRES',
    });
    deployService.getLastDeployment.mockResolvedValue(null);

    const result = await resolver.resolveRequestScope(
      createRequest({
        body: {
          projectId: 501,
        },
      }),
    );

    expect(result.source).toBe('explicit-request');
    expect(result.project.id).toBe(501);
    expect(result.workspace).toBeNull();
    expect(result.deployment).toBeNull();
    expect(result.deployHash).toBeNull();
  });

  it('rejects when deployHash does not match the requested kb snapshot', async () => {
    kbSnapshotRepository.findOneBy.mockResolvedValueOnce({
      id: 'snap-1',
      knowledgeBaseId: 'kb-1',
      deployHash: 'deploy-from-snapshot',
      legacyProjectId: 101,
    });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-1',
      workspaceId: 'ws-1',
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'ws-1',
      status: 'active',
    });
    projectRepository.findOneBy.mockResolvedValue({
      id: 101,
      language: 'EN',
      type: 'POSTGRES',
    });
    deployRepository.findOneBy.mockResolvedValue({
      id: 1,
      projectId: 101,
      hash: 'deploy-from-request',
      manifest: {},
    });

    await expect(
      resolver.resolveRequestScope(
        createRequest({
          body: {
            kbSnapshotId: 'snap-1',
            deployHash: 'deploy-from-request',
          },
        }),
      ),
    ).rejects.toThrow('deploy_hash does not match the requested kb_snapshot');
  });

  it('rejects workspace mismatch between session and requested scope', async () => {
    authService.validateSession.mockResolvedValue({
      actorClaims: {
        userId: 'user-1',
        workspaceId: 'ws-session',
        workspaceMemberId: 'member-1',
        roleKeys: ['member'],
        permissionScopes: ['knowledge_base:read'],
      },
      user: { id: 'user-1' },
      workspace: { id: 'ws-session' },
    });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-1',
      workspaceId: 'ws-request',
      defaultKbSnapshotId: 'snap-1',
    });
    kbSnapshotRepository.findOneBy.mockResolvedValue({
      id: 'snap-1',
      knowledgeBaseId: 'kb-1',
      deployHash: 'deploy-1',
      legacyProjectId: 44,
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'ws-request',
      status: 'active',
    });
    projectRepository.findOneBy.mockResolvedValue({
      id: 44,
      language: 'EN',
      type: 'POSTGRES',
    });
    deployRepository.findOneBy.mockResolvedValue({
      id: 3,
      projectId: 44,
      hash: 'deploy-1',
      manifest: {},
    });

    await expect(
      resolver.resolveRequestScope(
        createRequest({
          headers: {
            authorization: 'Bearer session-token',
          },
          body: {
            knowledgeBaseId: 'kb-1',
            deployHash: 'deploy-1',
          },
        }),
      ),
    ).rejects.toThrow('Session workspace does not match requested workspace');
  });
});
