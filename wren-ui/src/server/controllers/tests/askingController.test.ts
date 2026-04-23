import { AskingController } from '../askingController';
import { ChartType } from '../../models/adaptor';

describe('AskingController', () => {
  const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;
  const activeProjectId = 42;

  afterEach(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  const runtimeIdentity = {
    projectId: null,
    workspaceId: 'workspace-1',
    knowledgeBaseId: 'kb-1',
    kbSnapshotId: 'snapshot-1',
    deployHash: 'deploy-1',
    actorUserId: 'user-1',
  };

  const createAuthorizationActor = () => ({
    principalType: 'user',
    principalId: runtimeIdentity.actorUserId,
    workspaceId: runtimeIdentity.workspaceId,
    workspaceMemberId: 'member-1',
    workspaceRoleKeys: ['owner'],
    permissionScopes: ['workspace:*'],
    isPlatformAdmin: false,
    platformRoleKeys: [],
  });

  const createContext = (overrides: Record<string, any> = {}) =>
    ({
      runtimeScope: {
        selector: { runtimeScopeId: 'runtime-scope-1' },
        project: { id: activeProjectId, language: 'EN' },
        workspace: { id: runtimeIdentity.workspaceId },
        knowledgeBase: {
          id: runtimeIdentity.knowledgeBaseId,
          defaultKbSnapshotId: runtimeIdentity.kbSnapshotId,
        },
        kbSnapshot: { id: runtimeIdentity.kbSnapshotId },
        deployHash: runtimeIdentity.deployHash,
        userId: runtimeIdentity.actorUserId,
      },
      authorizationActor: createAuthorizationActor(),
      auditEventRepository: {
        createOne: jest.fn(),
      },
      telemetry: { sendEvent: jest.fn() },
      projectService: {
        getProjectById: jest.fn().mockResolvedValue({
          id: activeProjectId,
          language: 'EN',
          sampleDataset: null,
        }),
      },
      askingService: {
        assertThreadScope: jest.fn().mockResolvedValue(undefined),
        assertAskingTaskScope: jest.fn().mockResolvedValue(undefined),
        assertAskingTaskScopeById: jest.fn().mockResolvedValue(undefined),
        assertResponseScope: jest.fn().mockResolvedValue(undefined),
        getAskingTask: jest.fn().mockResolvedValue({
          question: 'What happened?',
          queryId: 'task-1',
          status: 'FINISHED',
          response: [],
        }),
        getAskingTaskById: jest.fn().mockResolvedValue({
          question: 'What happened?',
          queryId: 'task-1',
          status: 'FINISHED',
          response: [],
        }),
        cancelAskingTask: jest.fn().mockResolvedValue(undefined),
        createAskingTask: jest.fn().mockResolvedValue({ id: 'task-99' }),
        createThread: jest.fn().mockResolvedValue({ id: 99 }),
        createThreadResponse: jest.fn().mockResolvedValue({ id: 199 }),
        createThreadResponseScoped: jest.fn().mockResolvedValue({ id: 199 }),
        getThreadProject: jest.fn().mockResolvedValue({
          id: activeProjectId,
          language: 'EN',
        }),
        getResponsesWithThreadScoped: jest.fn().mockResolvedValue([]),
        listThreads: jest.fn().mockResolvedValue([]),
        updateThreadScoped: jest.fn().mockResolvedValue({ id: 99 }),
        deleteThreadScoped: jest.fn().mockResolvedValue(undefined),
        updateThreadResponseScoped: jest.fn().mockResolvedValue({ id: 199 }),
        adjustThreadResponseWithSQLScoped: jest
          .fn()
          .mockResolvedValue({ id: 199 }),
        adjustThreadResponseAnswerScoped: jest
          .fn()
          .mockResolvedValue({ id: 199 }),
        generateThreadResponseBreakdownScoped: jest
          .fn()
          .mockResolvedValue({ id: 199 }),
        generateThreadResponseAnswerScoped: jest
          .fn()
          .mockResolvedValue({ id: 199 }),
        generateThreadResponseChartScoped: jest
          .fn()
          .mockResolvedValue({ id: 199 }),
        adjustThreadResponseChartScoped: jest
          .fn()
          .mockResolvedValue({ id: 199 }),
        getResponseScoped: jest.fn().mockResolvedValue({ id: 199 }),
        previewDataScoped: jest.fn().mockResolvedValue([]),
        previewBreakdownDataScoped: jest.fn().mockResolvedValue([]),
        cancelAdjustThreadResponseAnswer: jest
          .fn()
          .mockResolvedValue(undefined),
        rerunAdjustThreadResponseAnswer: jest
          .fn()
          .mockResolvedValue({ queryId: 'adjust-1' }),
        getAdjustmentTaskById: jest.fn().mockResolvedValue({
          queryId: 'task-1',
          status: 'FINISHED',
          error: null,
          response: [{ sql: 'select 1' }],
          traceId: 'trace-1',
        }),
        createInstantRecommendedQuestions: jest
          .fn()
          .mockResolvedValue({ id: 'instant-1' }),
        getInstantRecommendedQuestions: jest.fn().mockResolvedValue({
          status: 'FINISHED',
          error: null,
          response: {
            questions: [{ question: 'q1', category: 'c1', sql: 'select 1' }],
          },
        }),
        getAdjustmentTask: jest.fn().mockResolvedValue({
          queryId: 'task-1',
          status: 'FINISHED',
          error: null,
          response: [{ sql: 'select 1' }],
          traceId: 'trace-1',
        }),
      },
      viewRepository: {
        findOneBy: jest.fn(),
      },
      modelService: {
        getViewByRuntimeIdentity: jest.fn(),
      },
      sqlPairService: {
        getSqlPair: jest.fn(),
      },
      sqlPairRepository: {
        findOneBy: jest.fn(),
      },
      knowledgeBaseRepository: {
        findOneBy: jest.fn(),
      },
      kbSnapshotRepository: {
        findOneBy: jest.fn(),
      },
      ...overrides,
    }) as any;

  it('rejects asking task creation without knowledge base read permission', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new AskingController();
    const ctx = createContext({
      authorizationActor: {
        ...createAuthorizationActor(),
        workspaceRoleKeys: ['owner'],
        permissionScopes: ['workspace:*'],
        grantedActions: [],
        workspaceRoleSource: 'legacy',
        platformRoleSource: 'legacy',
      },
    });

    await expect(
      resolver.createAskingTask(
        null,
        { data: { question: 'What happened?' } },
        ctx,
      ),
    ).rejects.toThrow('Knowledge base read permission required');

    expect(ctx.askingService.createAskingTask).not.toHaveBeenCalled();
  });

  it('scopes askingTask lookup to the active runtime identity', async () => {
    const resolver = new AskingController();
    const ctx = createContext();

    await resolver.getAskingTask(null, { taskId: 'task-1' }, ctx);

    expect(ctx.askingService.assertAskingTaskScope).toHaveBeenCalledWith(
      'task-1',
      runtimeIdentity,
    );
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'asking_task',
        resourceId: 'task-1',
        result: 'allowed',
        payloadJson: {
          operation: 'get_asking_task',
        },
      }),
    );
  });

  it('passes runtimeScopeId when generating thread response charts', async () => {
    const resolver = new AskingController();
    const ctx = createContext();

    await resolver.generateThreadResponseChart(null, { responseId: 199 }, ctx);

    expect(
      ctx.askingService.generateThreadResponseChartScoped,
    ).toHaveBeenCalledWith(
      199,
      runtimeIdentity,
      { language: 'Simplified Chinese' },
      'runtime-scope-1',
    );
  });

  it('passes runtimeScopeId when adjusting thread response charts', async () => {
    const resolver = new AskingController();
    const ctx = createContext();
    const data = { chartType: ChartType.BAR };

    await resolver.adjustThreadResponseChart(
      null,
      { responseId: 199, data },
      ctx,
    );

    expect(
      ctx.askingService.adjustThreadResponseChartScoped,
    ).toHaveBeenCalledWith(
      199,
      runtimeIdentity,
      data,
      { language: 'Simplified Chinese' },
      'runtime-scope-1',
    );
  });

  it('passes runtimeScopeId when adjusting thread response answers', async () => {
    const resolver = new AskingController();
    const ctx = createContext();
    const data = {
      tables: ['orders'],
      sqlGenerationReasoning: 'need filter',
    };

    await resolver.adjustThreadResponse(null, { responseId: 199, data }, ctx);

    expect(
      ctx.askingService.adjustThreadResponseAnswerScoped,
    ).toHaveBeenCalledWith(
      199,
      runtimeIdentity,
      {
        runtimeIdentity,
        tables: ['orders'],
        sqlGenerationReasoning: 'need filter',
      },
      { language: 'Simplified Chinese' },
      'runtime-scope-1',
    );
  });

  it('passes runtimeScopeId when rerunning thread response adjustments', async () => {
    const resolver = new AskingController();
    const ctx = createContext();

    await resolver.rerunAdjustThreadResponseAnswer(
      null,
      { responseId: 199 },
      ctx,
    );

    expect(
      ctx.askingService.rerunAdjustThreadResponseAnswer,
    ).toHaveBeenCalledWith(
      199,
      runtimeIdentity,
      { language: 'Simplified Chinese' },
      'runtime-scope-1',
    );
  });

  it('scopes askingTask cancellation to the active runtime identity', async () => {
    const resolver = new AskingController();
    const ctx = createContext();

    await resolver.cancelAskingTask(null, { taskId: 'task-1' }, ctx);

    expect(ctx.askingService.assertAskingTaskScope).toHaveBeenCalledWith(
      'task-1',
      runtimeIdentity,
    );
    expect(ctx.askingService.cancelAskingTask).toHaveBeenCalledWith('task-1');
  });

  it('validates task scope before creating a thread from an asking task', async () => {
    const resolver = new AskingController();
    const ctx = createContext();

    await resolver.createThread(null, { data: { taskId: 'task-1' } }, ctx);

    expect(ctx.askingService.assertAskingTaskScope).toHaveBeenCalledWith(
      'task-1',
      runtimeIdentity,
    );
    expect(ctx.askingService.getAskingTask).toHaveBeenCalledWith('task-1');
    expect(ctx.askingService.createThread).toHaveBeenCalledWith(
      {
        question: 'What happened?',
        trackedAskingResult: expect.objectContaining({
          queryId: 'task-1',
        }),
      },
      runtimeIdentity,
    );
  });

  it('creates asking task with the active runtime identity', async () => {
    const resolver = new AskingController();
    const ctx = createContext();

    await resolver.createAskingTask(
      null,
      { data: { question: 'What happened?' } },
      ctx,
    );

    expect(ctx.askingService.createAskingTask).toHaveBeenCalledWith(
      { question: 'What happened?' },
      expect.objectContaining({
        runtimeScopeId: 'runtime-scope-1',
        runtimeIdentity,
        threadId: undefined,
        language: 'Simplified Chinese',
      }),
    );
  });

  it('loads language from projectService when runtime scope project is absent', async () => {
    const resolver = new AskingController();
    const ctx = createContext({
      runtimeScope: {
        project: null,
        deployment: { projectId: activeProjectId },
        workspace: { id: runtimeIdentity.workspaceId },
        knowledgeBase: { id: runtimeIdentity.knowledgeBaseId },
        kbSnapshot: { id: runtimeIdentity.kbSnapshotId },
        deployHash: runtimeIdentity.deployHash,
        userId: runtimeIdentity.actorUserId,
      },
    });

    await resolver.createAskingTask(
      null,
      { data: { question: 'What happened?' } },
      ctx,
    );

    expect(ctx.projectService.getProjectById).toHaveBeenCalledWith(
      activeProjectId,
    );
    expect(ctx.askingService.createAskingTask).toHaveBeenCalledWith(
      { question: 'What happened?' },
      expect.objectContaining({
        language: 'Simplified Chinese',
      }),
    );
  });

  it('prefers knowledge base language over project language', async () => {
    const resolver = new AskingController();
    const ctx = createContext({
      runtimeScope: {
        selector: { runtimeScopeId: 'runtime-scope-1' },
        project: { id: activeProjectId, language: 'EN' },
        knowledgeBase: {
          id: runtimeIdentity.knowledgeBaseId,
          language: 'ZH_TW',
        },
        workspace: { id: runtimeIdentity.workspaceId },
        kbSnapshot: { id: runtimeIdentity.kbSnapshotId },
        deployHash: runtimeIdentity.deployHash,
        userId: runtimeIdentity.actorUserId,
      },
    });

    await resolver.createAskingTask(
      null,
      { data: { question: 'What happened?' } },
      ctx,
    );

    expect(ctx.askingService.createAskingTask).toHaveBeenCalledWith(
      { question: 'What happened?' },
      expect.objectContaining({
        language: 'Traditional Chinese',
      }),
    );
  });

  it('rejects asking task creation on outdated snapshots', async () => {
    const resolver = new AskingController();
    const ctx = createContext({
      runtimeScope: {
        selector: { runtimeScopeId: 'runtime-scope-old' },
        project: { id: activeProjectId, language: 'EN' },
        workspace: { id: runtimeIdentity.workspaceId },
        knowledgeBase: {
          id: runtimeIdentity.knowledgeBaseId,
          defaultKbSnapshotId: runtimeIdentity.kbSnapshotId,
        },
        kbSnapshot: { id: 'snapshot-old' },
        deployHash: 'deploy-old',
        userId: runtimeIdentity.actorUserId,
      },
    });

    await expect(
      resolver.createAskingTask(
        null,
        { data: { question: 'What happened?' } },
        ctx,
      ),
    ).rejects.toThrow('This snapshot is outdated and cannot be executed');
    expect(ctx.askingService.createAskingTask).not.toHaveBeenCalled();
  });

  it('returns sample suggested questions from knowledge base sample dataset', async () => {
    const resolver = new AskingController();
    const ctx = createContext({
      runtimeScope: {
        selector: { runtimeScopeId: 'runtime-scope-1' },
        project: { id: activeProjectId, language: 'EN' },
        knowledgeBase: {
          id: runtimeIdentity.knowledgeBaseId,
          sampleDataset: 'ECOMMERCE',
        },
        workspace: { id: runtimeIdentity.workspaceId },
        kbSnapshot: { id: runtimeIdentity.kbSnapshotId },
        deployHash: runtimeIdentity.deployHash,
        userId: runtimeIdentity.actorUserId,
      },
    });

    const result = await resolver.getSuggestedQuestions(null, {}, ctx);

    expect(result.questions.length).toBeGreaterThan(0);
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'knowledge_base',
        resourceId: runtimeIdentity.knowledgeBaseId,
        result: 'allowed',
        payloadJson: {
          operation: 'get_suggested_questions',
        },
      }),
    );
  });

  it('validates task scope before creating a follow-up response from an asking task', async () => {
    const resolver = new AskingController();
    const ctx = createContext();

    await resolver.createThreadResponse(
      null,
      { threadId: 12, data: { taskId: 'task-1' } },
      ctx,
    );

    expect(ctx.askingService.assertAskingTaskScope).toHaveBeenCalledWith(
      'task-1',
      runtimeIdentity,
    );
    expect(ctx.askingService.assertThreadScope).toHaveBeenCalledWith(
      12,
      runtimeIdentity,
    );
    expect(ctx.askingService.createThreadResponseScoped).toHaveBeenCalledWith(
      {
        question: 'What happened?',
        trackedAskingResult: expect.objectContaining({
          queryId: 'task-1',
        }),
      },
      12,
      runtimeIdentity,
    );
  });

  it('scopes cancelAdjustmentTask to the active runtime identity', async () => {
    const resolver = new AskingController();
    const ctx = createContext();

    await resolver.cancelAdjustThreadResponseAnswer(
      null,
      { taskId: 'task-1' },
      ctx,
    );

    expect(ctx.askingService.assertAskingTaskScope).toHaveBeenCalledWith(
      'task-1',
      runtimeIdentity,
    );
    expect(
      ctx.askingService.cancelAdjustThreadResponseAnswer,
    ).toHaveBeenCalledWith('task-1');
  });

  it('passes runtime scope when creating instant recommended questions', async () => {
    const resolver = new AskingController();
    const ctx = createContext();

    await resolver.createInstantRecommendedQuestions(
      null,
      { data: { previousQuestions: ['q0'] } },
      ctx,
    );

    expect(
      ctx.askingService.createInstantRecommendedQuestions,
    ).toHaveBeenCalledWith(
      { previousQuestions: ['q0'] },
      runtimeIdentity,
      'runtime-scope-1',
    );
  });

  it('scopes instant recommended questions lookup to the active runtime identity', async () => {
    const resolver = new AskingController();
    const ctx = createContext();

    await resolver.getInstantRecommendedQuestions(
      null,
      { taskId: 'instant-1' },
      ctx,
    );

    expect(
      ctx.askingService.getInstantRecommendedQuestions,
    ).toHaveBeenCalledWith('instant-1', runtimeIdentity);
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'asking_task',
        resourceId: 'instant-1',
        result: 'allowed',
        payloadJson: {
          operation: 'get_instant_recommended_questions',
        },
      }),
    );
  });

  it('records access audit when reading a thread', async () => {
    const resolver = new AskingController();
    const ctx = createContext({
      askingService: {
        ...createContext().askingService,
        assertThreadScope: jest.fn().mockResolvedValue({
          id: 12,
          summary: 'thread summary',
          workspaceId: runtimeIdentity.workspaceId,
          knowledgeBaseId: runtimeIdentity.knowledgeBaseId,
          knowledgeBaseIds: [runtimeIdentity.knowledgeBaseId],
          selectedSkillIds: [],
        }),
        getResponsesWithThreadScoped: jest.fn().mockResolvedValue([
          {
            id: 301,
            threadId: 12,
            question: 'What happened?',
            sql: 'select 1',
            askingTaskId: 'task-1',
            breakdownDetail: null,
            answerDetail: null,
            chartDetail: null,
            adjustment: null,
            viewId: null,
          },
        ]),
      },
    });

    await resolver.getThread(null, { threadId: 12 }, ctx);

    expect(ctx.askingService.assertThreadScope).toHaveBeenCalledWith(
      12,
      runtimeIdentity,
    );
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'thread',
        resourceId: '12',
        result: 'allowed',
        payloadJson: {
          operation: 'get_thread',
        },
      }),
    );
  });

  it('records access audit when reading a response and its preview data', async () => {
    const resolver = new AskingController();
    const ctx = createContext();

    await resolver.getResponse(null, { responseId: 199 }, ctx);
    await resolver.previewData(
      null,
      { where: { responseId: 199, limit: 10 } },
      ctx,
    );

    expect(ctx.askingService.getResponseScoped).toHaveBeenCalledWith(
      199,
      runtimeIdentity,
    );
    expect(ctx.askingService.previewDataScoped).toHaveBeenCalledWith(
      199,
      runtimeIdentity,
      10,
    );
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'thread_response',
        resourceId: '199',
        result: 'allowed',
        payloadJson: {
          operation: 'get_response',
        },
      }),
    );
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'thread_response',
        resourceId: '199',
        result: 'allowed',
        payloadJson: {
          operation: 'preview_data',
        },
      }),
    );
  });

  it('records access audit when reading adjustment task', async () => {
    const resolver = new AskingController();
    const ctx = createContext();

    await resolver.getAdjustmentTask(null, { taskId: 'task-1' }, ctx);

    expect(ctx.askingService.getAdjustmentTask).toHaveBeenCalledWith('task-1');
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'asking_task',
        resourceId: 'task-1',
        result: 'allowed',
        payloadJson: {
          operation: 'get_adjustment_task',
        },
      }),
    );
  });

  it('hides candidate views and sql pairs outside the active project', async () => {
    const resolver = new AskingController();
    const ctx = createContext({
      askingService: {
        ...createContext().askingService,
        getAskingTask: jest.fn().mockResolvedValue({
          question: 'What happened?',
          queryId: 'task-1',
          status: 'FINISHED',
          response: [
            {
              type: 'VIEW',
              sql: 'select 1',
              viewId: 10,
              sqlpairId: 20,
            },
          ],
        }),
      },
      viewRepository: {
        findOneBy: jest.fn().mockResolvedValue({
          id: 10,
          projectId: 99,
          name: 'foreign_view',
        }),
      },
      modelService: {
        getViewByRuntimeIdentity: jest.fn().mockResolvedValue(null),
      },
      sqlPairRepository: {
        findOneBy: jest.fn().mockResolvedValue({
          id: 20,
          projectId: 99,
          question: 'foreign',
          sql: 'select 2',
        }),
      },
      sqlPairService: {
        getSqlPair: jest.fn().mockResolvedValue(null),
      },
    });

    const result = await resolver.getAskingTask(
      null,
      { taskId: 'task-1' },
      ctx,
    );

    expect(ctx.modelService.getViewByRuntimeIdentity).toHaveBeenCalledWith(
      runtimeIdentity,
      10,
    );
    expect(ctx.sqlPairService.getSqlPair).toHaveBeenCalledWith(
      runtimeIdentity,
      20,
    );
    expect(result).not.toBeNull();
    expect(result?.candidates).toEqual([
      expect.objectContaining({
        view: null,
        sqlPair: null,
      }),
    ]);
  });

  it('returns null for thread response view outside the active project', async () => {
    const resolver = new AskingController();
    const ctx = createContext({
      modelService: {
        getViewByRuntimeIdentity: jest.fn().mockResolvedValue(null),
      },
    });

    const nested = resolver.getThreadResponseNestedResolver();
    const result = await nested.view({ viewId: 10 } as any, null, ctx);

    expect(ctx.modelService.getViewByRuntimeIdentity).toHaveBeenCalledWith(
      runtimeIdentity,
      10,
    );
    expect(result).toBeNull();
  });

  it('scopes thread response askingTask nested lookup to the active runtime identity', async () => {
    const resolver = new AskingController();
    const ctx = createContext();
    const nested = resolver.getThreadResponseNestedResolver();

    await nested.askingTask(
      { askingTaskId: 88, adjustment: null } as any,
      null,
      ctx,
    );

    expect(ctx.askingService.assertAskingTaskScopeById).toHaveBeenCalledWith(
      88,
      runtimeIdentity,
    );
    expect(ctx.askingService.getAskingTaskById).toHaveBeenCalledWith(88);
  });

  it('scopes thread response adjustmentTask nested lookup to the active runtime identity', async () => {
    const resolver = new AskingController();
    const ctx = createContext();
    const nested = resolver.getThreadResponseNestedResolver();

    await nested.adjustmentTask(
      { askingTaskId: 99, adjustment: { type: 'REASONING' } } as any,
      null,
      ctx,
    );

    expect(ctx.askingService.assertAskingTaskScopeById).toHaveBeenCalledWith(
      99,
      runtimeIdentity,
    );
    expect(ctx.askingService.getAdjustmentTaskById).toHaveBeenCalledWith(99);
  });
});
