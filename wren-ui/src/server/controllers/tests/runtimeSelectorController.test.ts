import { RuntimeSelectorController } from '../runtimeSelectorController';

describe('RuntimeSelectorController', () => {
  const createAuthorizationActor = (workspaceId = 'ws-1') => ({
    principalType: 'user',
    principalId: 'user-1',
    workspaceId,
    workspaceMemberId: 'member-1',
    workspaceRoleKeys: ['owner'],
    permissionScopes: ['workspace:*'],
    isPlatformAdmin: false,
    platformRoleKeys: [],
  });

  it('returns null when runtime scope is unavailable', async () => {
    const resolver = new RuntimeSelectorController();

    await expect(
      resolver.getRuntimeSelectorState({
        ctx: {
          runtimeScope: null,
        } as any,
      }),
    ).resolves.toBeNull();
  });

  it('returns null when workspace scope is not available yet', async () => {
    const resolver = new RuntimeSelectorController();

    await expect(
      resolver.getRuntimeSelectorState({
        ctx: {
          runtimeScope: {
            project: {
              id: 42,
            },
            workspace: null,
          },
        } as any,
      }),
    ).resolves.toBeNull();
  });

  it('returns the current workspace and visible KB/snapshot options', async () => {
    const resolver = new RuntimeSelectorController();
    const auditEventRepository = {
      createOne: jest.fn(),
    };
    const knowledgeBaseRepository = {
      findAllBy: jest.fn().mockResolvedValue([
        {
          id: 'kb-z',
          workspaceId: 'ws-1',
          slug: 'kb-z',
          name: 'Zeta KB',
        },
        {
          id: 'kb-a',
          workspaceId: 'ws-1',
          slug: 'kb-a',
          name: 'Alpha KB',
        },
        {
          id: 'kb-archived',
          workspaceId: 'ws-1',
          slug: 'kb-archived',
          name: 'Archived KB',
          archivedAt: new Date('2026-04-01T00:00:00Z'),
        },
      ]),
    };
    const kbSnapshotRepository = {
      findAllBy: jest.fn().mockResolvedValue([
        {
          id: 'snap-z',
          knowledgeBaseId: 'kb-current',
          snapshotKey: 'zeta',
          displayName: 'Zeta Snapshot',
          deployHash: 'deploy-z',
          status: 'active',
        },
        {
          id: 'snap-disabled',
          knowledgeBaseId: 'kb-current',
          snapshotKey: 'disabled',
          displayName: 'Disabled Snapshot',
          deployHash: 'deploy-disabled',
          status: 'disabled',
        },
      ]),
      findOneBy: jest.fn().mockResolvedValue({
        id: 'snap-current',
        knowledgeBaseId: 'kb-current',
        snapshotKey: 'current',
        displayName: 'Current Snapshot',
        deployHash: 'deploy-current',
        status: 'draft',
      }),
    };
    const modelRepository = {
      findAllByRuntimeIdentity: jest.fn().mockImplementation(async (scope) => {
        if (scope.knowledgeBaseId === 'kb-current') {
          return [{ id: 1 }, { id: 2 }];
        }
        return [];
      }),
    };
    const viewRepository = {
      findAllByRuntimeIdentity: jest.fn().mockImplementation(async (scope) => {
        if (scope.knowledgeBaseId === 'kb-current') {
          return [{ id: 11 }];
        }
        return [];
      }),
    };

    const result = await resolver.getRuntimeSelectorState({
      ctx: {
        runtimeScope: {
          project: {
            id: 99,
          },
          workspace: {
            id: 'ws-1',
            slug: 'workspace-1',
            name: 'Workspace 1',
          },
          knowledgeBase: {
            id: 'kb-current',
            workspaceId: 'ws-1',
            slug: 'kb-current',
            name: 'Current KB',
            defaultKbSnapshotId: 'snap-current',
          },
          kbSnapshot: {
            id: 'snap-current',
            knowledgeBaseId: 'kb-current',
            snapshotKey: 'current',
            displayName: 'Current Snapshot',
            deployHash: 'deploy-current',
            status: 'draft',
          },
        },
        authorizationActor: createAuthorizationActor(),
        auditEventRepository,
        knowledgeBaseRepository,
        kbSnapshotRepository,
        modelRepository,
        viewRepository,
      } as any,
    });

    expect(knowledgeBaseRepository.findAllBy).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
    });
    expect(kbSnapshotRepository.findAllBy).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-current',
    });
    expect(result).toEqual({
      currentWorkspace: {
        id: 'ws-1',
        slug: 'workspace-1',
        name: 'Workspace 1',
        kind: null,
      },
      workspaces: [
        {
          id: 'ws-1',
          slug: 'workspace-1',
          name: 'Workspace 1',
          kind: null,
        },
      ],
      currentKnowledgeBase: {
        id: 'kb-current',
        slug: 'kb-current',
        name: 'Current KB',
        kind: null,
        defaultKbSnapshotId: 'snap-current',
        assetCount: 3,
      },
      currentKbSnapshot: {
        id: 'snap-current',
        snapshotKey: 'current',
        displayName: 'Current Snapshot',
        deployHash: 'deploy-current',
        status: 'draft',
      },
      knowledgeBases: [
        {
          id: 'kb-a',
          slug: 'kb-a',
          name: 'Alpha KB',
          kind: null,
          defaultKbSnapshotId: null,
          assetCount: 0,
        },
        {
          id: 'kb-current',
          slug: 'kb-current',
          name: 'Current KB',
          kind: null,
          defaultKbSnapshotId: 'snap-current',
          assetCount: 3,
        },
        {
          id: 'kb-z',
          slug: 'kb-z',
          name: 'Zeta KB',
          kind: null,
          defaultKbSnapshotId: null,
          assetCount: 0,
        },
      ],
      kbSnapshots: [
        {
          id: 'snap-current',
          snapshotKey: 'current',
          displayName: 'Current Snapshot',
          deployHash: 'deploy-current',
          status: 'draft',
        },
        {
          id: 'snap-z',
          snapshotKey: 'zeta',
          displayName: 'Zeta Snapshot',
          deployHash: 'deploy-z',
          status: 'active',
        },
      ],
    });
    expect(auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workspace.read',
        resourceType: 'workspace',
        resourceId: 'ws-1',
        result: 'allowed',
        payloadJson: {
          operation: 'get_runtime_selector_state',
        },
      }),
    );
  });

  it('returns workspace-only runtime selector state when no knowledge base exists yet', async () => {
    const resolver = new RuntimeSelectorController();
    const auditEventRepository = {
      createOne: jest.fn(),
    };
    const currentWorkspace = {
      id: 'ws-empty',
      slug: 'ws-empty',
      name: 'Empty Workspace',
      kind: 'regular',
    };
    const knowledgeBaseRepository = {
      findAllBy: jest.fn().mockResolvedValue([]),
    };
    const kbSnapshotRepository = {
      findAllBy: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(null),
    };
    const modelRepository = {
      findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
    };
    const viewRepository = {
      findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
    };
    const workspaceService = {
      listWorkspacesForUser: jest.fn().mockResolvedValue([currentWorkspace]),
    };

    const result = await resolver.getRuntimeSelectorState({
      ctx: {
        runtimeScope: {
          workspace: currentWorkspace,
          knowledgeBase: null,
          kbSnapshot: null,
        },
        requestActor: {
          userId: 'user-1',
          workspaceId: currentWorkspace.id,
        },
        workspaceService,
        authorizationActor: createAuthorizationActor(currentWorkspace.id),
        auditEventRepository,
        knowledgeBaseRepository,
        kbSnapshotRepository,
        modelRepository,
        viewRepository,
      } as any,
    });

    expect(knowledgeBaseRepository.findAllBy).toHaveBeenCalledWith({
      workspaceId: currentWorkspace.id,
    });
    expect(result).toEqual({
      currentWorkspace: {
        id: 'ws-empty',
        slug: 'ws-empty',
        name: 'Empty Workspace',
        kind: 'regular',
      },
      workspaces: [
        {
          id: 'ws-empty',
          slug: 'ws-empty',
          name: 'Empty Workspace',
          kind: 'regular',
        },
      ],
      currentKnowledgeBase: null,
      currentKbSnapshot: null,
      knowledgeBases: [],
      kbSnapshots: [],
    });
  });

  it('drops a stale knowledge base when the runtime workspace changes', async () => {
    const resolver = new RuntimeSelectorController();
    const knowledgeBaseRepository = {
      findAllBy: jest.fn().mockResolvedValue([
        {
          id: 'kb-ops',
          workspaceId: 'ws-ops',
          slug: 'kb-ops',
          name: 'Ops KB',
          defaultKbSnapshotId: 'snap-ops',
        },
      ]),
    };
    const kbSnapshotRepository = {
      findAllBy: jest.fn().mockImplementation(({ knowledgeBaseId }) =>
        Promise.resolve(
          knowledgeBaseId === 'kb-ops'
            ? [
                {
                  id: 'snap-ops',
                  knowledgeBaseId: 'kb-ops',
                  snapshotKey: 'ops',
                  displayName: 'Ops Snapshot',
                  deployHash: 'deploy-ops',
                  status: 'active',
                },
              ]
            : [],
        ),
      ),
      findOneBy: jest.fn().mockResolvedValue(null),
    };
    const modelRepository = {
      findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
    };
    const viewRepository = {
      findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
    };

    const result = await resolver.getRuntimeSelectorState({
      ctx: {
        runtimeScope: {
          workspace: {
            id: 'ws-ops',
            slug: 'ops-workspace',
            name: 'Ops Workspace',
          },
          knowledgeBase: {
            id: 'kb-stale',
            workspaceId: 'ws-retail',
            slug: 'kb-stale',
            name: 'Retail Sample KB',
          },
          kbSnapshot: {
            id: 'snap-stale',
            knowledgeBaseId: 'kb-stale',
            snapshotKey: 'stale',
            displayName: 'Retail Sample Snapshot',
            deployHash: 'deploy-stale',
            status: 'active',
          },
        },
        authorizationActor: createAuthorizationActor('ws-ops'),
        auditEventRepository: {
          createOne: jest.fn(),
        },
        knowledgeBaseRepository,
        kbSnapshotRepository,
        modelRepository,
        viewRepository,
      } as any,
    });

    expect(result?.currentWorkspace).toEqual({
      id: 'ws-ops',
      slug: 'ops-workspace',
      name: 'Ops Workspace',
      kind: null,
    });
    expect(result?.currentKnowledgeBase).toEqual({
      id: 'kb-ops',
      slug: 'kb-ops',
      name: 'Ops KB',
      kind: null,
      defaultKbSnapshotId: 'snap-ops',
      assetCount: 0,
    });
    expect(result?.currentKbSnapshot).toEqual({
      id: 'snap-ops',
      snapshotKey: 'ops',
      displayName: 'Ops Snapshot',
      deployHash: 'deploy-ops',
      status: 'active',
    });
    expect(result?.knowledgeBases).toEqual([
      {
        id: 'kb-ops',
        slug: 'kb-ops',
        name: 'Ops KB',
        kind: null,
        defaultKbSnapshotId: 'snap-ops',
        assetCount: 0,
      },
    ]);
  });

  it('bootstraps workspace and default KB snapshot from request actor when runtime scope is missing', async () => {
    const resolver = new RuntimeSelectorController();
    const workspaceRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'ws-actor',
        slug: 'workspace-actor',
        name: 'Workspace Actor',
      }),
    };
    const workspaceService = {
      listWorkspacesForUser: jest.fn().mockResolvedValue([
        {
          id: 'ws-zeta',
          slug: 'workspace-zeta',
          name: 'Workspace Zeta',
          status: 'active',
        },
        {
          id: 'ws-actor',
          slug: 'workspace-actor',
          name: 'Workspace Actor',
          status: 'active',
        },
      ]),
    };
    const knowledgeBaseRepository = {
      findAllBy: jest.fn().mockResolvedValue([
        {
          id: 'kb-beta',
          workspaceId: 'ws-actor',
          slug: 'kb-beta',
          name: 'Beta KB',
          defaultKbSnapshotId: null,
        },
        {
          id: 'kb-alpha',
          workspaceId: 'ws-actor',
          slug: 'kb-alpha',
          name: 'Alpha KB',
          defaultKbSnapshotId: 'snap-default',
        },
      ]),
    };
    const kbSnapshotRepository = {
      findAllBy: jest.fn().mockResolvedValue([
        {
          id: 'snap-default',
          knowledgeBaseId: 'kb-alpha',
          snapshotKey: 'prod',
          displayName: 'Prod Snapshot',
          deployHash: 'deploy-prod',
          status: 'active',
        },
        {
          id: 'snap-dev',
          knowledgeBaseId: 'kb-alpha',
          snapshotKey: 'dev',
          displayName: 'Dev Snapshot',
          deployHash: 'deploy-dev',
          status: 'active',
        },
      ]),
      findOneBy: jest.fn().mockResolvedValue({
        id: 'snap-default',
        knowledgeBaseId: 'kb-alpha',
        snapshotKey: 'prod',
        displayName: 'Prod Snapshot',
        deployHash: 'deploy-prod',
        status: 'active',
      }),
    };
    const modelRepository = {
      findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
    };
    const viewRepository = {
      findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
    };

    const result = await resolver.getRuntimeSelectorState({
      ctx: {
        runtimeScope: null,
        authorizationActor: createAuthorizationActor('ws-actor'),
        auditEventRepository: {
          createOne: jest.fn(),
        },
        requestActor: {
          sessionToken: 'session-token',
          userId: 'user-1',
          workspaceId: 'ws-actor',
          actorClaims: {
            userId: 'user-1',
            workspaceId: 'ws-actor',
            workspaceMemberId: 'member-1',
            roleKeys: ['owner'],
            permissionScopes: ['workspace:*'],
          },
        },
        workspaceRepository,
        workspaceService,
        knowledgeBaseRepository,
        kbSnapshotRepository,
        modelRepository,
        viewRepository,
      } as any,
    });

    expect(workspaceService.listWorkspacesForUser).toHaveBeenCalledWith(
      'user-1',
    );
    expect(workspaceRepository.findOneBy).toHaveBeenCalledWith({
      id: 'ws-actor',
    });
    expect(knowledgeBaseRepository.findAllBy).toHaveBeenCalledWith({
      workspaceId: 'ws-actor',
    });
    expect(kbSnapshotRepository.findAllBy).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-alpha',
    });
    expect(result).toEqual({
      currentWorkspace: {
        id: 'ws-actor',
        slug: 'workspace-actor',
        name: 'Workspace Actor',
        kind: null,
      },
      workspaces: [
        {
          id: 'ws-actor',
          slug: 'workspace-actor',
          name: 'Workspace Actor',
          kind: null,
        },
        {
          id: 'ws-zeta',
          slug: 'workspace-zeta',
          name: 'Workspace Zeta',
          kind: null,
        },
      ],
      currentKnowledgeBase: {
        id: 'kb-alpha',
        slug: 'kb-alpha',
        name: 'Alpha KB',
        kind: null,
        defaultKbSnapshotId: 'snap-default',
        assetCount: 0,
      },
      currentKbSnapshot: {
        id: 'snap-default',
        snapshotKey: 'prod',
        displayName: 'Prod Snapshot',
        deployHash: 'deploy-prod',
        status: 'active',
      },
      knowledgeBases: [
        {
          id: 'kb-alpha',
          slug: 'kb-alpha',
          name: 'Alpha KB',
          kind: null,
          defaultKbSnapshotId: 'snap-default',
          assetCount: 0,
        },
        {
          id: 'kb-beta',
          slug: 'kb-beta',
          name: 'Beta KB',
          kind: null,
          defaultKbSnapshotId: null,
          assetCount: 0,
        },
      ],
      kbSnapshots: [
        {
          id: 'snap-dev',
          snapshotKey: 'dev',
          displayName: 'Dev Snapshot',
          deployHash: 'deploy-dev',
          status: 'active',
        },
        {
          id: 'snap-default',
          snapshotKey: 'prod',
          displayName: 'Prod Snapshot',
          deployHash: 'deploy-prod',
          status: 'active',
        },
      ],
    });
  });

  it('falls back to a deployable knowledge base when the current one has no executable snapshot', async () => {
    const resolver = new RuntimeSelectorController();
    const knowledgeBaseRepository = {
      findAllBy: jest.fn().mockResolvedValue([
        {
          id: 'kb-empty',
          workspaceId: 'ws-1',
          slug: 'kb-empty',
          name: '111',
          defaultKbSnapshotId: null,
        },
        {
          id: 'kb-ready',
          workspaceId: 'ws-1',
          slug: 'kb-ready',
          name: '电商订单数据',
          defaultKbSnapshotId: 'snap-ready',
        },
      ]),
    };
    const kbSnapshotRepository = {
      findAllBy: jest.fn().mockImplementation(({ knowledgeBaseId }) =>
        Promise.resolve(
          knowledgeBaseId === 'kb-ready'
            ? [
                {
                  id: 'snap-ready',
                  knowledgeBaseId: 'kb-ready',
                  snapshotKey: 'prod',
                  displayName: 'Prod Snapshot',
                  deployHash: 'deploy-ready',
                  status: 'active',
                },
              ]
            : [],
        ),
      ),
      findOneBy: jest.fn().mockResolvedValue({
        id: 'snap-ready',
        knowledgeBaseId: 'kb-ready',
        snapshotKey: 'prod',
        displayName: 'Prod Snapshot',
        deployHash: 'deploy-ready',
        status: 'active',
      }),
    };
    const modelRepository = {
      findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
    };
    const viewRepository = {
      findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
    };

    const result = await resolver.getRuntimeSelectorState({
      ctx: {
        runtimeScope: {
          project: { id: 42 },
          workspace: {
            id: 'ws-1',
            slug: 'workspace-1',
            name: 'Workspace 1',
          },
          knowledgeBase: {
            id: 'kb-empty',
            workspaceId: 'ws-1',
            slug: 'kb-empty',
            name: '111',
            defaultKbSnapshotId: null,
          },
          kbSnapshot: null,
          deployment: null,
          deployHash: null,
        },
        authorizationActor: createAuthorizationActor(),
        auditEventRepository: {
          createOne: jest.fn(),
        },
        knowledgeBaseRepository,
        kbSnapshotRepository,
        modelRepository,
        viewRepository,
      } as any,
    });

    expect(result).toEqual({
      currentWorkspace: {
        id: 'ws-1',
        slug: 'workspace-1',
        name: 'Workspace 1',
        kind: null,
      },
      workspaces: [
        {
          id: 'ws-1',
          slug: 'workspace-1',
          name: 'Workspace 1',
          kind: null,
        },
      ],
      currentKnowledgeBase: {
        id: 'kb-ready',
        slug: 'kb-ready',
        name: '电商订单数据',
        kind: null,
        defaultKbSnapshotId: 'snap-ready',
        assetCount: 0,
      },
      currentKbSnapshot: {
        id: 'snap-ready',
        snapshotKey: 'prod',
        displayName: 'Prod Snapshot',
        deployHash: 'deploy-ready',
        status: 'active',
      },
      knowledgeBases: [
        {
          id: 'kb-empty',
          slug: 'kb-empty',
          name: '111',
          kind: null,
          defaultKbSnapshotId: null,
          assetCount: 0,
        },
        {
          id: 'kb-ready',
          slug: 'kb-ready',
          name: '电商订单数据',
          kind: null,
          defaultKbSnapshotId: 'snap-ready',
          assetCount: 0,
        },
      ],
      kbSnapshots: [
        {
          id: 'snap-ready',
          snapshotKey: 'prod',
          displayName: 'Prod Snapshot',
          deployHash: 'deploy-ready',
          status: 'active',
        },
      ],
    });
  });

  it('rejects runtime selector access without workspace read permission', async () => {
    const resolver = new RuntimeSelectorController();

    await expect(
      resolver.getRuntimeSelectorState({
        ctx: {
          runtimeScope: {
            workspace: {
              id: 'ws-1',
              slug: 'workspace-1',
              name: 'Workspace 1',
            },
          },
          authorizationActor: {
            ...createAuthorizationActor(),
            workspaceRoleKeys: [],
            permissionScopes: [],
          },
          auditEventRepository: {
            createOne: jest.fn(),
          },
          knowledgeBaseRepository: {
            findAllBy: jest.fn(),
          },
          kbSnapshotRepository: {
            findAllBy: jest.fn(),
            findOneBy: jest.fn(),
          },
        } as any,
      }),
    ).rejects.toThrow('Workspace read permission required');
  });
});
