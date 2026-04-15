import { SqlPairResolver } from '../sqlPairResolver';

describe('SqlPairResolver', () => {
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

  it('validates sql with runtime execution context when creating sql pairs', async () => {
    const resolver = new SqlPairResolver();
    const preview = jest.fn().mockResolvedValue({});
    const createSqlPair = jest.fn().mockResolvedValue({
      id: 1,
      sql: 'select 1',
      question: 'q1',
    });

    await resolver.createSqlPair(
      null,
      {
        data: {
          sql: 'select 1',
          question: 'q1',
        },
      },
      {
        runtimeScope: {
          project: { id: 42, language: 'EN' },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
          deployment: { manifest: { models: ['m1'] } },
        },
        authorizationActor: createAuthorizationActor(),
        auditEventRepository: { createOne: jest.fn() },
        telemetry: { sendEvent: jest.fn() },
        queryService: { preview },
        projectService: { getProjectById: jest.fn() },
        sqlPairService: { createSqlPair },
        knowledgeBaseRepository: { findOneBy: jest.fn() },
        kbSnapshotRepository: { findOneBy: jest.fn() },
      } as any,
    );

    expect(preview).toHaveBeenCalledWith('select 1', {
      manifest: { models: ['m1'] },
      project: { id: 42, language: 'EN' },
      dryRun: true,
    });
    expect(createSqlPair).toHaveBeenCalledWith(
      {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: null,
      },
      {
        sql: 'select 1',
        question: 'q1',
      },
    );
  });

  it('uses runtime deployment manifest for model substitute without deployService', async () => {
    const resolver = new SqlPairResolver();
    const modelSubstitute = jest.fn().mockResolvedValue('select * from foo');
    const createOne = jest.fn();

    const result = await resolver.modelSubstitute(
      null,
      {
        data: {
          sql: 'SELECT * FROM foo' as any,
        },
      },
      {
        runtimeScope: {
          project: { id: 42, language: 'EN' },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
          deployment: { manifest: { models: ['m1'] } },
        },
        authorizationActor: {
          ...createAuthorizationActor(),
          grantedActions: ['knowledge_base.read'],
          workspaceRoleSource: 'role_binding',
        },
        auditEventRepository: { createOne },
        telemetry: { sendEvent: jest.fn() },
        projectService: { getProjectById: jest.fn() },
        sqlPairService: { modelSubstitute },
        knowledgeBaseRepository: { findOneBy: jest.fn() },
        kbSnapshotRepository: { findOneBy: jest.fn() },
      } as any,
    );

    expect(modelSubstitute).toHaveBeenCalledWith('SELECT * FROM foo', {
      project: { id: 42, language: 'EN' },
      manifest: { models: ['m1'] },
    });
    expect(createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'knowledge_base',
        resourceId: 'kb-1',
        result: 'allowed',
        payloadJson: {
          operation: 'model_substitute',
        },
      }),
    );
    expect(result).toContain('select');
    expect(result).toContain('foo');
  });

  it('falls back to projectService when runtime scope project is absent', async () => {
    const resolver = new SqlPairResolver();
    const preview = jest.fn().mockResolvedValue({});
    const createSqlPair = jest.fn().mockResolvedValue({
      id: 1,
      sql: 'select 1',
      question: 'q1',
    });
    const getProjectById = jest.fn().mockResolvedValue({
      id: 42,
      language: 'EN',
    });

    await resolver.createSqlPair(
      null,
      {
        data: {
          sql: 'select 1',
          question: 'q1',
        },
      },
      {
        runtimeScope: {
          project: null,
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
          deployment: { projectId: 42, manifest: { models: ['m1'] } },
        },
        authorizationActor: createAuthorizationActor(),
        auditEventRepository: { createOne: jest.fn() },
        telemetry: { sendEvent: jest.fn() },
        queryService: { preview },
        projectService: { getProjectById },
        sqlPairService: { createSqlPair },
        knowledgeBaseRepository: { findOneBy: jest.fn() },
        kbSnapshotRepository: { findOneBy: jest.fn() },
      } as any,
    );

    expect(getProjectById).toHaveBeenCalledWith(42);
    expect(preview).toHaveBeenCalledWith('select 1', {
      manifest: { models: ['m1'] },
      project: { id: 42, language: 'EN' },
      dryRun: true,
    });
  });

  it('records allowed access audit events for sql pair reads', async () => {
    const resolver = new SqlPairResolver();
    const listSqlPairs = jest.fn().mockResolvedValue([
      {
        id: 1,
        sql: 'select 1',
        question: 'q1',
      },
    ]);
    const createOne = jest.fn();

    const result = await resolver.getProjectSqlPairs(null, null, {
      runtimeScope: {
        project: { id: 42, language: 'EN' },
        workspace: { id: 'workspace-1' },
        knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
        kbSnapshot: { id: 'snapshot-1' },
        deployHash: 'deploy-1',
      },
      authorizationActor: {
        ...createAuthorizationActor(),
        grantedActions: ['knowledge_base.read'],
        workspaceRoleSource: 'role_binding',
      },
      auditEventRepository: { createOne },
      sqlPairService: { listSqlPairs },
    } as any);

    expect(listSqlPairs).toHaveBeenCalledWith({
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: null,
    });
    expect(createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'knowledge_base',
        resourceId: 'kb-1',
        result: 'allowed',
        payloadJson: {
          operation: 'get_project_sql_pairs',
        },
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 1,
      }),
    ]);
  });

  it('rejects sql pair reads in binding-only mode without granted actions', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new SqlPairResolver();
    const listSqlPairs = jest.fn();

    await expect(
      resolver.getProjectSqlPairs(null, null, {
        runtimeScope: {
          project: { id: 42, language: 'EN' },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
        },
        authorizationActor: {
          ...createAuthorizationActor(),
          grantedActions: [],
          workspaceRoleSource: 'legacy',
          platformRoleSource: 'legacy',
        },
        auditEventRepository: { createOne: jest.fn() },
        sqlPairService: { listSqlPairs },
      } as any),
    ).rejects.toThrow('Knowledge base read permission required');

    expect(listSqlPairs).not.toHaveBeenCalled();
  });

  it('rejects model substitute in binding-only mode without granted actions', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new SqlPairResolver();
    const modelSubstitute = jest.fn();

    await expect(
      resolver.modelSubstitute(
        null,
        {
          data: {
            sql: 'SELECT * FROM foo' as any,
          },
        },
        {
          runtimeScope: {
            project: { id: 42, language: 'EN' },
            workspace: { id: 'workspace-1' },
            knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
            kbSnapshot: { id: 'snapshot-1' },
            deployHash: 'deploy-1',
            deployment: { manifest: { models: ['m1'] } },
          },
          authorizationActor: {
            ...createAuthorizationActor(),
            grantedActions: [],
            workspaceRoleSource: 'legacy',
            platformRoleSource: 'legacy',
          },
          auditEventRepository: { createOne: jest.fn() },
          telemetry: { sendEvent: jest.fn() },
          projectService: { getProjectById: jest.fn() },
          sqlPairService: { modelSubstitute },
          knowledgeBaseRepository: { findOneBy: jest.fn() },
          kbSnapshotRepository: { findOneBy: jest.fn() },
        } as any,
      ),
    ).rejects.toThrow('Knowledge base read permission required');

    expect(modelSubstitute).not.toHaveBeenCalled();
  });

  it('records allowed access audit events for generateQuestion', async () => {
    const resolver = new SqlPairResolver();
    const generateQuestions = jest.fn().mockResolvedValue(['question-1']);
    const createOne = jest.fn();

    const result = await resolver.generateQuestion(
      null,
      {
        data: {
          sql: 'select 1',
        },
      },
      {
        runtimeScope: {
          project: { id: 42, language: 'EN' },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
          deployment: { manifest: { models: ['m1'] } },
        },
        authorizationActor: {
          ...createAuthorizationActor(),
          grantedActions: ['knowledge_base.read'],
          workspaceRoleSource: 'role_binding',
        },
        auditEventRepository: { createOne },
        sqlPairService: { generateQuestions },
        projectService: { getProjectById: jest.fn() },
        knowledgeBaseRepository: { findOneBy: jest.fn() },
        kbSnapshotRepository: { findOneBy: jest.fn() },
      } as any,
    );

    expect(generateQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42 }),
      ['select 1'],
    );
    expect(createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'knowledge_base',
        resourceId: 'kb-1',
        result: 'allowed',
        payloadJson: {
          operation: 'generate_question',
        },
      }),
    );
    expect(result).toBe('question-1');
  });

  it('rejects generateQuestion in binding-only mode without granted actions', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new SqlPairResolver();
    const generateQuestions = jest.fn();

    await expect(
      resolver.generateQuestion(
        null,
        {
          data: {
            sql: 'select 1',
          },
        },
        {
          runtimeScope: {
            project: { id: 42, language: 'EN' },
            workspace: { id: 'workspace-1' },
            knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
            kbSnapshot: { id: 'snapshot-1' },
            deployHash: 'deploy-1',
            deployment: { manifest: { models: ['m1'] } },
          },
          authorizationActor: {
            ...createAuthorizationActor(),
            grantedActions: [],
            workspaceRoleSource: 'legacy',
            platformRoleSource: 'legacy',
          },
          auditEventRepository: { createOne: jest.fn() },
          sqlPairService: { generateQuestions },
          projectService: { getProjectById: jest.fn() },
          knowledgeBaseRepository: { findOneBy: jest.fn() },
          kbSnapshotRepository: { findOneBy: jest.fn() },
        } as any,
      ),
    ).rejects.toThrow('Knowledge base read permission required');

    expect(generateQuestions).not.toHaveBeenCalled();
  });

  it('rejects sql pair validation on outdated snapshots', async () => {
    const resolver = new SqlPairResolver();
    const preview = jest.fn().mockResolvedValue({});
    const createSqlPair = jest.fn();

    await expect(
      resolver.createSqlPair(
        null,
        {
          data: {
            sql: 'select 1',
            question: 'q1',
          },
        },
        {
          runtimeScope: {
            project: { id: 42, language: 'EN' },
            workspace: { id: 'workspace-1' },
            knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
            kbSnapshot: { id: 'snapshot-old' },
            deployHash: 'deploy-old',
            deployment: { manifest: { models: ['m1'] } },
          },
          authorizationActor: createAuthorizationActor(),
          auditEventRepository: { createOne: jest.fn() },
          telemetry: { sendEvent: jest.fn() },
          queryService: { preview },
          projectService: { getProjectById: jest.fn() },
          sqlPairService: { createSqlPair },
          knowledgeBaseRepository: { findOneBy: jest.fn() },
          kbSnapshotRepository: { findOneBy: jest.fn() },
        } as any,
      ),
    ).rejects.toThrow('This snapshot is outdated and cannot be executed');

    expect(preview).not.toHaveBeenCalled();
    expect(createSqlPair).not.toHaveBeenCalled();
  });

  it('rejects sql pair deletion on outdated snapshots', async () => {
    const resolver = new SqlPairResolver();
    const deleteSqlPair = jest.fn();

    await expect(
      resolver.deleteSqlPair(
        null,
        {
          where: {
            id: 1,
          },
        },
        {
          runtimeScope: {
            project: { id: 42, language: 'EN' },
            workspace: { id: 'workspace-1' },
            knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
            kbSnapshot: { id: 'snapshot-old' },
            deployHash: 'deploy-old',
            deployment: { manifest: { models: ['m1'] } },
          },
          authorizationActor: createAuthorizationActor(),
          auditEventRepository: { createOne: jest.fn() },
          telemetry: { sendEvent: jest.fn() },
          sqlPairService: { deleteSqlPair },
          knowledgeBaseRepository: { findOneBy: jest.fn() },
          kbSnapshotRepository: { findOneBy: jest.fn() },
        } as any,
      ),
    ).rejects.toThrow('This snapshot is outdated and cannot be executed');

    expect(deleteSqlPair).not.toHaveBeenCalled();
  });

  it('rejects sql pair writes without knowledge base write permission', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new SqlPairResolver();
    const preview = jest.fn();
    const createSqlPair = jest.fn();

    await expect(
      resolver.createSqlPair(
        null,
        {
          data: {
            sql: 'select 1',
            question: 'q1',
          },
        },
        {
          runtimeScope: {
            project: { id: 42, language: 'EN' },
            workspace: { id: 'workspace-1' },
            knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
            kbSnapshot: { id: 'snapshot-1' },
            deployHash: 'deploy-1',
            deployment: { manifest: { models: ['m1'] } },
          },
          authorizationActor: {
            ...createAuthorizationActor(),
            workspaceRoleKeys: ['owner'],
            permissionScopes: ['workspace:*'],
            grantedActions: [],
            workspaceRoleSource: 'legacy',
            platformRoleSource: 'legacy',
          },
          auditEventRepository: { createOne: jest.fn() },
          telemetry: { sendEvent: jest.fn() },
          queryService: { preview },
          projectService: { getProjectById: jest.fn() },
          sqlPairService: { createSqlPair },
          knowledgeBaseRepository: { findOneBy: jest.fn() },
          kbSnapshotRepository: { findOneBy: jest.fn() },
        } as any,
      ),
    ).rejects.toThrow('Knowledge base write permission required');

    expect(preview).not.toHaveBeenCalled();
    expect(createSqlPair).not.toHaveBeenCalled();
  });

  it('records succeeded audit events for sql pair creation', async () => {
    const resolver = new SqlPairResolver();
    const preview = jest.fn().mockResolvedValue({});
    const createSqlPair = jest.fn().mockResolvedValue({
      id: 11,
      sql: 'select 1',
      question: 'q1',
    });
    const createOne = jest.fn();

    await resolver.createSqlPair(
      null,
      {
        data: {
          sql: 'select 1',
          question: 'q1',
        },
      },
      {
        runtimeScope: {
          project: { id: 42, language: 'EN' },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
          deployment: { manifest: { models: ['m1'] } },
        },
        authorizationActor: createAuthorizationActor(),
        auditEventRepository: { createOne },
        telemetry: { sendEvent: jest.fn() },
        queryService: { preview },
        projectService: { getProjectById: jest.fn() },
        sqlPairService: { createSqlPair },
        knowledgeBaseRepository: { findOneBy: jest.fn() },
        kbSnapshotRepository: { findOneBy: jest.fn() },
      } as any,
    );

    expect(createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        resourceType: 'sql_pair',
        resourceId: '11',
        result: 'succeeded',
      }),
    );
  });
});
