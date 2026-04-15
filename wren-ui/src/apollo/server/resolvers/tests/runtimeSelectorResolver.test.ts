import { RuntimeSelectorResolver } from '../runtimeSelectorResolver';

describe('RuntimeSelectorResolver', () => {
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
    const resolver = new RuntimeSelectorResolver();

    await expect(
      resolver.getRuntimeSelectorState(null, null, {
        runtimeScope: null,
      } as any),
    ).resolves.toBeNull();
  });

  it('returns null when workspace scope is not available yet', async () => {
    const resolver = new RuntimeSelectorResolver();

    await expect(
      resolver.getRuntimeSelectorState(null, null, {
        runtimeScope: {
          project: {
            id: 42,
          },
          workspace: null,
        },
      } as any),
    ).resolves.toBeNull();
  });

  it('returns the current workspace and visible KB/snapshot options', async () => {
    const resolver = new RuntimeSelectorResolver();
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

    const result = await resolver.getRuntimeSelectorState(null, null, {
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
    } as any);

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
        },
        {
          id: 'kb-current',
          slug: 'kb-current',
          name: 'Current KB',
          kind: null,
          defaultKbSnapshotId: 'snap-current',
        },
        {
          id: 'kb-z',
          slug: 'kb-z',
          name: 'Zeta KB',
          kind: null,
          defaultKbSnapshotId: null,
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

  it('bootstraps workspace and default KB snapshot from request actor when runtime scope is missing', async () => {
    const resolver = new RuntimeSelectorResolver();
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

    const result = await resolver.getRuntimeSelectorState(null, null, {
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
    } as any);

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
        },
        {
          id: 'kb-beta',
          slug: 'kb-beta',
          name: 'Beta KB',
          kind: null,
          defaultKbSnapshotId: null,
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
    const resolver = new RuntimeSelectorResolver();
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

    const result = await resolver.getRuntimeSelectorState(null, null, {
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
    } as any);

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
        },
        {
          id: 'kb-ready',
          slug: 'kb-ready',
          name: '电商订单数据',
          kind: null,
          defaultKbSnapshotId: 'snap-ready',
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
    const resolver = new RuntimeSelectorResolver();

    await expect(
      resolver.getRuntimeSelectorState(null, null, {
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
      } as any),
    ).rejects.toThrow('Workspace read permission required');
  });
});
