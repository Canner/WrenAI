import { DiagramController } from '../diagramController';

describe('DiagramController', () => {
  const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

  afterEach(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  const createAuthorizationActor = () => ({
    principalType: 'user',
    principalId: 'user-1',
    workspaceId: 'workspace-1',
    workspaceMemberId: 'member-1',
    workspaceRoleKeys: ['owner'],
    permissionScopes: ['workspace:*'],
    isPlatformAdmin: false,
    platformRoleKeys: [],
  });

  it('builds diagrams from runtime-identity scoped repositories instead of runtimeScope.project', async () => {
    const resolver = new DiagramController();
    const runtimeIdentity = {
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    };
    const model = {
      id: 7,
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      displayName: 'Orders',
      referenceName: 'orders',
      sourceTableName: 'orders',
      refSql: 'select * from orders',
      cached: false,
      refreshTime: null,
      properties: JSON.stringify({ description: 'orders table' }),
    };

    const ctx = {
      runtimeScope: {
        project: null,
        deployment: { hash: 'deploy-1', projectId: 42, manifest: {} },
        workspace: { id: 'workspace-1' },
        knowledgeBase: { id: 'kb-1' },
        kbSnapshot: { id: 'snapshot-1' },
        deployHash: 'deploy-1',
        userId: 'user-1',
      },
      authorizationActor: createAuthorizationActor(),
      auditEventRepository: {
        createOne: jest.fn(),
      },
      mdlService: {
        makeCurrentModelMDLByRuntimeIdentity: jest.fn().mockResolvedValue({
          project: { id: 42, language: 'EN', type: 'POSTGRES' },
          manifest: {
            models: [{ name: 'orders', columns: [] }],
          },
        }),
      },
      modelRepository: {
        findAllByRuntimeIdentity: jest.fn().mockResolvedValue([model]),
      },
      modelColumnRepository: {
        findColumnsByModelIds: jest.fn().mockResolvedValue([
          {
            id: 1,
            modelId: 7,
            isCalculated: false,
            displayName: 'Order ID',
            referenceName: 'order_id',
            type: 'integer',
            isPk: true,
            properties: JSON.stringify({}),
          },
        ]),
      },
      modelNestedColumnRepository: {
        findNestedColumnsByModelIds: jest.fn().mockResolvedValue([]),
      },
      relationRepository: {
        findRelationInfoBy: jest.fn().mockResolvedValue([]),
      },
      viewRepository: {
        findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
      },
    } as any;

    const result = await resolver.getDiagram({ ctx });

    expect(
      ctx.mdlService.makeCurrentModelMDLByRuntimeIdentity,
    ).toHaveBeenCalledWith(runtimeIdentity);
    expect(ctx.modelRepository.findAllByRuntimeIdentity).toHaveBeenCalledWith(
      runtimeIdentity,
    );
    expect(ctx.viewRepository.findAllByRuntimeIdentity).toHaveBeenCalledWith(
      runtimeIdentity,
    );
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'diagram',
        resourceId: 'kb-1',
        result: 'allowed',
        payloadJson: {
          operation: 'get_diagram',
        },
      }),
    );
    expect(result.models).toHaveLength(1);
    expect(result.models[0].referenceName).toBe('orders');
    expect(result.models[0].recommendation).toEqual({
      error: null,
      queryId: null,
      questions: [],
      status: 'NOT_STARTED',
      updatedAt: null,
    });
  });

  it('rejects diagram access without knowledge base read permission', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new DiagramController();

    await expect(
      resolver.getDiagram({
        ctx: {
          runtimeScope: {
            project: null,
            deployment: { hash: 'deploy-1', projectId: 42, manifest: {} },
            workspace: { id: 'workspace-1' },
            knowledgeBase: { id: 'kb-1' },
            kbSnapshot: { id: 'snapshot-1' },
            deployHash: 'deploy-1',
            userId: 'user-1',
          },
          authorizationActor: {
            ...createAuthorizationActor(),
            workspaceRoleKeys: ['owner'],
            permissionScopes: ['workspace:*'],
            grantedActions: [],
            workspaceRoleSource: 'legacy',
            platformRoleSource: 'legacy',
          },
          auditEventRepository: {
            createOne: jest.fn(),
          },
          mdlService: {
            makeCurrentModelMDLByRuntimeIdentity: jest.fn(),
          },
          modelRepository: {
            findAllByRuntimeIdentity: jest.fn(),
          },
          modelColumnRepository: {
            findColumnsByModelIds: jest.fn(),
          },
          modelNestedColumnRepository: {
            findNestedColumnsByModelIds: jest.fn(),
          },
          relationRepository: {
            findRelationInfoBy: jest.fn(),
          },
          viewRepository: {
            findAllByRuntimeIdentity: jest.fn(),
          },
        } as any,
      }),
    ).rejects.toThrow('Knowledge base read permission required');
  });

  it('falls back to scoped models when executable deployment metadata is not available yet', async () => {
    const resolver = new DiagramController();
    const ctx = {
      runtimeScope: {
        project: null,
        deployment: null,
        workspace: { id: 'workspace-1' },
        knowledgeBase: { id: 'kb-1' },
        kbSnapshot: { id: 'snapshot-1' },
        deployHash: null,
        userId: 'user-1',
      },
      authorizationActor: createAuthorizationActor(),
      auditEventRepository: {
        createOne: jest.fn(),
      },
      mdlService: {
        makeCurrentModelMDLByRuntimeIdentity: jest
          .fn()
          .mockRejectedValue(
            new Error(
              'MDL runtime identity requires deploy metadata or resolvable project metadata',
            ),
          ),
      },
      modelRepository: {
        findAllByRuntimeIdentity: jest.fn().mockResolvedValue([
          {
            id: 7,
            displayName: 'Orders',
            referenceName: 'orders',
            sourceTableName: 'orders',
            refSql: 'select * from orders',
            cached: false,
            refreshTime: null,
            properties: JSON.stringify({
              description: 'orders table',
              aiRecommendations: {
                status: 'FINISHED',
                queryId: 'rq-1',
                questions: [
                  {
                    category: '分析',
                    question: '按地区查看订单趋势',
                    sql: 'select 1',
                  },
                ],
                error: null,
                updatedAt: '2026-04-20T12:00:00.000Z',
              },
            }),
          },
        ]),
      },
      modelColumnRepository: {
        findColumnsByModelIds: jest.fn().mockResolvedValue([]),
      },
      modelNestedColumnRepository: {
        findNestedColumnsByModelIds: jest.fn().mockResolvedValue([]),
      },
      relationRepository: {
        findRelationInfoBy: jest.fn().mockResolvedValue([]),
      },
      viewRepository: {
        findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
      },
    } as any;

    await expect(resolver.getDiagram({ ctx })).resolves.toEqual({
      models: [
        expect.objectContaining({
          referenceName: 'orders',
          recommendation: expect.objectContaining({
            status: 'FINISHED',
            queryId: 'rq-1',
            questions: [
              expect.objectContaining({
                question: '按地区查看订单趋势',
              }),
            ],
          }),
        }),
      ],
      views: [],
    });
  });
});
