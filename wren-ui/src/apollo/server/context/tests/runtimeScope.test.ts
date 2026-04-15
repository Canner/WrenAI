import {
  RuntimeScopeResolver,
  toPersistedRuntimeIdentity,
} from '../runtimeScope';

const createRequest = (overrides: Partial<any> = {}) =>
  ({
    headers: {},
    body: {},
    query: {},
    ...overrides,
  }) as any;

describe('RuntimeScopeResolver', () => {
  let projectRepository: any;
  let deployService: any;
  let authService: any;
  let workspaceRepository: any;
  let knowledgeBaseRepository: any;
  let kbSnapshotRepository: any;
  let resolver: RuntimeScopeResolver;

  beforeEach(() => {
    const getDeploymentByRuntimeIdentity = jest.fn();
    projectRepository = {
      getCurrentProject: jest.fn(),
      findOneBy: jest.fn(),
    };
    deployService = {
      getDeployment: getDeploymentByRuntimeIdentity,
      getDeploymentByRuntimeIdentity,
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
      bridgeProjectId: 101,
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
    deployService.getDeployment.mockResolvedValue({
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
    expect(result.project?.id ?? result.deployment?.projectId).toBe(101);
    expect(result.deployHash).toBe('deploy-1');
    expect(result.selector.workspaceId).toBe('ws-1');
    expect(result.selector.knowledgeBaseId).toBe('kb-1');
    expect(result.selector.kbSnapshotId).toBe('snap-1');
  });

  it('allows deployment-backed runtime scopes to resolve without hydrating a project bridge', async () => {
    kbSnapshotRepository.findOneBy.mockResolvedValueOnce({
      id: 'snap-no-project',
      knowledgeBaseId: 'kb-no-project',
      deployHash: 'deploy-no-project',
      bridgeProjectId: null,
    });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-no-project',
      workspaceId: 'ws-no-project',
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'ws-no-project',
      status: 'active',
    });
    projectRepository.findOneBy.mockResolvedValue(null);
    deployService.getDeployment.mockResolvedValue({
      id: 20,
      projectId: 2020,
      hash: 'deploy-no-project',
      manifest: {},
    });

    const result = await resolver.resolveRequestScope(
      createRequest({
        body: {
          kbSnapshotId: 'snap-no-project',
        },
      }),
    );

    expect(result.project).toBeNull();
    expect(result.deployment?.projectId).toBe(2020);
    expect(result.deployHash).toBe('deploy-no-project');
  });

  it('resolves explicit runtime scope via kb_snapshot deploy hash when legacy project bridge is absent', async () => {
    kbSnapshotRepository.findOneBy.mockResolvedValueOnce({
      id: 'snap-2',
      knowledgeBaseId: 'kb-2',
      deployHash: 'deploy-2',
      bridgeProjectId: null,
    });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-2',
      workspaceId: 'ws-2',
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'ws-2',
      status: 'active',
    });
    projectRepository.findOneBy.mockResolvedValue({
      id: 202,
      language: 'EN',
      type: 'POSTGRES',
    });
    deployService.getDeployment.mockResolvedValue({
      id: 2,
      projectId: 202,
      hash: 'deploy-2',
      manifest: {},
    });

    const result = await resolver.resolveRequestScope(
      createRequest({
        body: {
          kbSnapshotId: 'snap-2',
        },
      }),
    );

    expect(result.project?.id ?? result.deployment?.projectId).toBe(202);
    expect(result.deployHash).toBe('deploy-2');
    expect(result.selector.kbSnapshotId).toBe('snap-2');
    expect(deployService.getDeploymentByRuntimeIdentity).toHaveBeenCalledWith({
      workspaceId: null,
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snap-2',
      projectId: null,
      deployHash: 'deploy-2',
    });
  });

  it('resolves runtime scope ids by trying deploy hash before legacy project bridge', async () => {
    projectRepository.findOneBy.mockResolvedValue({
      id: 501,
      language: 'EN',
      type: 'POSTGRES',
    });
    deployService.getDeployment.mockResolvedValue({
      id: 5,
      projectId: 501,
      hash: 'deploy-explicit',
      manifest: {},
    });

    const result = await resolver.resolveRuntimeScopeId(' deploy-explicit ');

    expect(result.project?.id ?? result.deployment?.projectId).toBe(501);
    expect(result.deployHash).toBe('deploy-explicit');
    expect(result.selector.deployHash).toBe('deploy-explicit');
    expect(result.selector.bridgeProjectId).toBeNull();
    expect(deployService.getDeploymentByRuntimeIdentity).toHaveBeenCalledWith({
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      projectId: null,
      deployHash: 'deploy-explicit',
    });
  });

  it('reads explicit selector from graphql variables payload', async () => {
    kbSnapshotRepository.findOneBy.mockResolvedValueOnce({
      id: 'snap-vars',
      knowledgeBaseId: 'kb-vars',
      deployHash: 'deploy-vars',
      bridgeProjectId: 301,
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
    deployService.getDeployment.mockResolvedValue({
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
    expect(result.project?.id ?? result.deployment?.projectId).toBe(301);
    expect(result.selector.kbSnapshotId).toBe('snap-vars');
    expect(result.selector.bridgeProjectId).toBeNull();
  });

  it('ignores legacy project selectors when canonical runtime fields are present', async () => {
    kbSnapshotRepository.findOneBy.mockResolvedValueOnce({
      id: 'snap-modern',
      knowledgeBaseId: 'kb-modern',
      deployHash: 'deploy-modern',
      bridgeProjectId: 901,
    });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-modern',
      workspaceId: 'ws-modern',
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'ws-modern',
      status: 'active',
    });
    projectRepository.findOneBy.mockResolvedValue({
      id: 901,
      language: 'EN',
      type: 'POSTGRES',
    });
    deployService.getDeployment.mockResolvedValue({
      id: 90,
      projectId: 901,
      hash: 'deploy-modern',
      manifest: {},
    });

    const result = await resolver.resolveRequestScope(
      createRequest({
        body: {
          kbSnapshotId: 'snap-modern',
          projectId: 777,
        },
      }),
    );

    expect(result.project?.id ?? result.deployment?.projectId).toBe(901);
    expect(result.selector.kbSnapshotId).toBe('snap-modern');
    expect(result.selector.bridgeProjectId).toBeNull();
    expect(kbSnapshotRepository.findOneBy).not.toHaveBeenCalledWith({
      bridgeProjectId: 777,
    });
    expect(deployService.getDeploymentByRuntimeIdentity).toHaveBeenCalledWith({
      workspaceId: null,
      knowledgeBaseId: 'kb-modern',
      kbSnapshotId: 'snap-modern',
      projectId: null,
      deployHash: 'deploy-modern',
    });
  });

  it('converts resolved runtime scope through the shared persisted identity helper', () => {
    expect(
      toPersistedRuntimeIdentity({
        source: 'explicit-request',
        selector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
          bridgeProjectId: 42,
        },
        project: { id: 42 } as any,
        deployment: null,
        deployHash: 'deploy-1',
        workspace: { id: 'ws-1' } as any,
        knowledgeBase: { id: 'kb-1' } as any,
        kbSnapshot: { id: 'snap-1' } as any,
        actorClaims: null,
        userId: 'user-1',
      } as any),
    ).toEqual({
      projectId: 42,
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    });
  });

  it('falls back to legacy project shim when request scope is absent', async () => {
    projectRepository.getCurrentProject.mockResolvedValue({
      id: 7,
      language: 'EN',
      type: 'POSTGRES',
    });
    deployService.getDeployment.mockResolvedValue({
      id: 11,
      projectId: 7,
      hash: 'deploy-7',
      manifest: {},
    });
    kbSnapshotRepository.findOneBy.mockResolvedValue({
      id: 'snap-7',
      knowledgeBaseId: 'kb-7',
      deployHash: 'deploy-7',
      bridgeProjectId: 7,
    });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-7',
      workspaceId: 'ws-7',
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'ws-7',
      status: 'active',
    });

    await expect(resolver.resolveRequestScope(createRequest())).rejects.toThrow(
      'Runtime scope selector is required for this request',
    );

    expect(projectRepository.getCurrentProject).not.toHaveBeenCalled();
  });

  it('requires an explicit selector when no runtime scope selector is provided', async () => {
    await expect(resolver.resolveRequestScope(createRequest())).rejects.toThrow(
      'Runtime scope selector is required for this request',
    );

    expect(projectRepository.getCurrentProject).not.toHaveBeenCalled();
  });

  it('resolves a numeric runtimeScopeId through the project bridge without workspace or deployment', async () => {
    projectRepository.findOneBy.mockResolvedValue({
      id: 501,
      language: 'EN',
      type: 'POSTGRES',
    });
    deployService.getDeployment.mockResolvedValue(null);

    const result = await resolver.resolveRequestScope(
      createRequest({
        body: {
          runtimeScopeId: '501',
        },
      }),
    );

    expect(result.source).toBe('explicit-request');
    expect(result.project?.id ?? result.deployment?.projectId).toBe(501);
    expect(result.workspace).toBeNull();
    expect(result.deployment).toBeNull();
    expect(result.deployHash).toBeNull();
    expect(result.selector.runtimeScopeId).toBe('501');
    expect(result.selector.bridgeProjectId).toBe(501);
    expect(kbSnapshotRepository.findOneBy).not.toHaveBeenCalledWith({
      bridgeProjectId: 501,
    });
  });

  it('rejects removed legacy project request keys now that canonical runtime scope ids are required', async () => {
    await expect(
      resolver.resolveRequestScope(
        createRequest({
          body: {
            projectId: 501,
          },
        }),
      ),
    ).rejects.toThrow('Runtime scope selector is required for this request');
  });

  it('resolves explicit runtime scope via deploy hash bridge without kb snapshot', async () => {
    projectRepository.findOneBy.mockResolvedValue({
      id: 601,
      language: 'EN',
      type: 'POSTGRES',
    });
    deployService.getDeployment.mockResolvedValue({
      id: 88,
      projectId: 601,
      hash: 'deploy-601',
      manifest: {},
    });

    const result = await resolver.resolveRequestScope(
      createRequest({
        body: {
          deployHash: 'deploy-601',
        },
      }),
    );

    expect(result.project?.id ?? result.deployment?.projectId).toBe(601);
    expect(result.deployment?.hash).toBe('deploy-601');
    expect(deployService.getDeploymentByRuntimeIdentity).toHaveBeenCalledWith({
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      projectId: null,
      deployHash: 'deploy-601',
    });
  });

  it('uses canonical runtime selectors instead of legacy project hints when both are present', async () => {
    kbSnapshotRepository.findOneBy.mockResolvedValueOnce({
      id: 'snap-bridge',
      knowledgeBaseId: 'kb-bridge',
      deployHash: 'deploy-bridge',
      bridgeProjectId: 777,
    });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-bridge',
      workspaceId: 'ws-bridge',
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'ws-bridge',
      status: 'active',
    });
    projectRepository.findOneBy.mockResolvedValue({
      id: 777,
      language: 'EN',
      type: 'POSTGRES',
    });
    deployService.getDeployment.mockResolvedValue({
      id: 77,
      projectId: 777,
      hash: 'deploy-bridge',
      manifest: {},
    });

    const result = await resolver.resolveRequestScope(
      createRequest({
        body: {
          workspaceId: 'ws-bridge',
          knowledgeBaseId: 'kb-bridge',
          kbSnapshotId: 'snap-bridge',
          projectId: 777,
        },
      }),
    );

    expect(result.selector.workspaceId).toBe('ws-bridge');
    expect(result.selector.knowledgeBaseId).toBe('kb-bridge');
    expect(result.selector.kbSnapshotId).toBe('snap-bridge');
    expect(result.selector.bridgeProjectId).toBeNull();
    expect(result.project?.id ?? result.deployment?.projectId).toBe(777);
    expect(result.deployHash).toBe('deploy-bridge');
  });

  it('resolves knowledge-base scoped requests without requiring a legacy project bridge', async () => {
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-scope-only',
      workspaceId: 'ws-scope-only',
      defaultKbSnapshotId: 'snap-scope-only',
    });
    kbSnapshotRepository.findOneBy.mockResolvedValue({
      id: 'snap-scope-only',
      knowledgeBaseId: 'kb-scope-only',
      deployHash: 'deploy-scope-only',
      bridgeProjectId: null,
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'ws-scope-only',
      status: 'active',
    });
    deployService.getDeploymentByRuntimeIdentity.mockResolvedValue({
      id: 18,
      projectId: 818,
      hash: 'deploy-scope-only',
      manifest: {},
    });
    projectRepository.findOneBy.mockResolvedValue({
      id: 818,
      language: 'EN',
      type: 'POSTGRES',
    });

    const result = await resolver.resolveRequestScope(
      createRequest({
        body: {
          knowledgeBaseId: 'kb-scope-only',
        },
      }),
    );

    expect(result.project?.id ?? result.deployment?.projectId).toBe(818);
    expect(result.deployment?.hash).toBe('deploy-scope-only');
    expect(result.deployHash).toBe('deploy-scope-only');
    expect(result.selector.workspaceId).toBe('ws-scope-only');
    expect(result.selector.knowledgeBaseId).toBe('kb-scope-only');
    expect(result.selector.kbSnapshotId).toBe('snap-scope-only');
    expect(deployService.getDeploymentByRuntimeIdentity).toHaveBeenCalledWith({
      workspaceId: null,
      knowledgeBaseId: 'kb-scope-only',
      kbSnapshotId: 'snap-scope-only',
      projectId: null,
      deployHash: 'deploy-scope-only',
    });
  });

  it('resolves knowledge-base scoped requests via latest runtime deployment even when no default snapshot legacy bridge exists', async () => {
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-latest-only',
      workspaceId: 'ws-latest-only',
      defaultKbSnapshotId: null,
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'ws-latest-only',
      status: 'active',
    });
    deployService.getDeploymentByRuntimeIdentity.mockResolvedValue({
      id: 19,
      projectId: 919,
      hash: 'deploy-latest-only',
      manifest: {},
    });
    projectRepository.findOneBy.mockResolvedValue({
      id: 919,
      language: 'EN',
      type: 'POSTGRES',
    });

    const result = await resolver.resolveRequestScope(
      createRequest({
        body: {
          knowledgeBaseId: 'kb-latest-only',
        },
      }),
    );

    expect(result.project?.id ?? result.deployment?.projectId).toBe(919);
    expect(result.deployment?.hash).toBe('deploy-latest-only');
    expect(result.deployHash).toBe('deploy-latest-only');
    expect(result.selector.workspaceId).toBe('ws-latest-only');
    expect(result.selector.knowledgeBaseId).toBe('kb-latest-only');
    expect(result.selector.kbSnapshotId).toBeNull();
    expect(deployService.getDeploymentByRuntimeIdentity).toHaveBeenCalledWith({
      workspaceId: null,
      knowledgeBaseId: 'kb-latest-only',
      kbSnapshotId: null,
      projectId: null,
      deployHash: null,
    });
  });

  it('rejects when deployHash does not match the requested kb snapshot', async () => {
    kbSnapshotRepository.findOneBy.mockResolvedValueOnce({
      id: 'snap-1',
      knowledgeBaseId: 'kb-1',
      deployHash: 'deploy-from-snapshot',
      bridgeProjectId: 101,
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
    deployService.getDeployment.mockResolvedValue({
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
      bridgeProjectId: 44,
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
    deployService.getDeploymentByRuntimeIdentity.mockResolvedValue({
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

  it('resolves generic runtimeScopeId request headers before falling back to legacy project selectors', async () => {
    projectRepository.findOneBy.mockResolvedValue({
      id: 44,
      language: 'EN',
      type: 'POSTGRES',
    });
    deployService.getDeployment.mockResolvedValue({
      id: 4,
      projectId: 44,
      hash: 'deploy-header',
      manifest: {},
    });

    const result = await resolver.resolveRequestScope(
      createRequest({
        headers: {
          'x-wren-runtime-scope-id': 'deploy-header',
        },
      }),
    );

    expect(result.project?.id ?? result.deployment?.projectId).toBe(44);
    expect(result.deployHash).toBe('deploy-header');
    expect(result.selector.runtimeScopeId).toBe('deploy-header');
    expect(result.selector.deployHash).toBe('deploy-header');
    expect(result.selector.bridgeProjectId).toBeNull();
  });

  it('hydrates deployment hash when runtimeScopeId falls back to a legacy project bridge', async () => {
    projectRepository.findOneBy.mockResolvedValue({
      id: 44,
      language: 'EN',
      type: 'POSTGRES',
    });
    deployService.getDeploymentByRuntimeIdentity.mockImplementation(
      async (runtimeIdentity: { projectId?: number | null } | null) =>
        runtimeIdentity?.projectId === 44
          ? {
              id: 5,
              projectId: 44,
              hash: 'deploy-legacy-44',
              manifest: {},
            }
          : null,
    );

    const result = await resolver.resolveRequestScope(
      createRequest({
        headers: {
          'x-wren-runtime-scope-id': '44',
        },
      }),
    );

    expect(result.project?.id).toBe(44);
    expect(result.deployment?.hash).toBe('deploy-legacy-44');
    expect(result.deployHash).toBe('deploy-legacy-44');
    expect(result.selector.runtimeScopeId).toBe('44');
    expect(result.selector.bridgeProjectId).toBe(44);
    expect(kbSnapshotRepository.findOneBy).not.toHaveBeenCalledWith({
      bridgeProjectId: 44,
    });
  });
});
