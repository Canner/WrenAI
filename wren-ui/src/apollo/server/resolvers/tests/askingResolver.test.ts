import { AskingResolver } from '../askingResolver';

describe('AskingResolver', () => {
  const runtimeIdentity = {
    projectId: 42,
    workspaceId: 'workspace-1',
    knowledgeBaseId: 'kb-1',
    kbSnapshotId: 'snapshot-1',
    deployHash: 'deploy-1',
    actorUserId: 'user-1',
  };

  const createContext = (overrides: Record<string, any> = {}) =>
    ({
      runtimeScope: {
        selector: { runtimeScopeId: 'runtime-scope-1' },
        project: { id: runtimeIdentity.projectId, language: 'EN' },
        workspace: { id: runtimeIdentity.workspaceId },
        knowledgeBase: { id: runtimeIdentity.knowledgeBaseId },
        kbSnapshot: { id: runtimeIdentity.kbSnapshotId },
        deployHash: runtimeIdentity.deployHash,
        userId: runtimeIdentity.actorUserId,
      },
      telemetry: { sendEvent: jest.fn() },
      projectService: {
        generateProjectRecommendationQuestions: jest.fn(),
        getProjectById: jest.fn().mockResolvedValue({
          id: runtimeIdentity.projectId,
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
        generateThreadRecommendationQuestions: jest
          .fn()
          .mockResolvedValue(undefined),
        getThreadProject: jest.fn().mockResolvedValue({
          id: runtimeIdentity.projectId,
          language: 'EN',
        }),
        getResponsesWithThreadScoped: jest.fn().mockResolvedValue([]),
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
      ...overrides,
    }) as any;

  it('scopes askingTask lookup to the active runtime identity', async () => {
    const resolver = new AskingResolver();
    const ctx = createContext();

    await resolver.getAskingTask(null, { taskId: 'task-1' }, ctx);

    expect(ctx.askingService.assertAskingTaskScope).toHaveBeenCalledWith(
      'task-1',
      runtimeIdentity,
    );
  });

  it('scopes project recommendation generation to the active runtime identity', async () => {
    const resolver = new AskingResolver();
    const ctx = createContext();

    await resolver.generateProjectRecommendationQuestions(null, {}, ctx);

    expect(
      ctx.projectService.generateProjectRecommendationQuestions,
    ).toHaveBeenCalledWith(runtimeIdentity.projectId, 'runtime-scope-1');
  });

  it('falls back to deployment.projectId when runtime scope project is absent', async () => {
    const resolver = new AskingResolver();
    const ctx = createContext({
      runtimeScope: {
        project: null,
        deployment: { projectId: runtimeIdentity.projectId },
        workspace: { id: runtimeIdentity.workspaceId },
        knowledgeBase: { id: runtimeIdentity.knowledgeBaseId },
        kbSnapshot: { id: runtimeIdentity.kbSnapshotId },
        deployHash: runtimeIdentity.deployHash,
        userId: runtimeIdentity.actorUserId,
      },
    });

    await resolver.generateProjectRecommendationQuestions(null, {}, ctx);

    expect(
      ctx.projectService.generateProjectRecommendationQuestions,
    ).toHaveBeenCalledWith(runtimeIdentity.projectId, null);
  });

  it('scopes askingTask cancellation to the active runtime identity', async () => {
    const resolver = new AskingResolver();
    const ctx = createContext();

    await resolver.cancelAskingTask(null, { taskId: 'task-1' }, ctx);

    expect(ctx.askingService.assertAskingTaskScope).toHaveBeenCalledWith(
      'task-1',
      runtimeIdentity,
    );
    expect(ctx.askingService.cancelAskingTask).toHaveBeenCalledWith('task-1');
  });

  it('validates task scope before creating a thread from an asking task', async () => {
    const resolver = new AskingResolver();
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
    const resolver = new AskingResolver();
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
        actorClaims: null,
        threadId: undefined,
        language: 'English',
      }),
    );
  });

  it('loads language from projectService when runtime scope project is absent', async () => {
    const resolver = new AskingResolver();
    const ctx = createContext({
      runtimeScope: {
        project: null,
        deployment: { projectId: runtimeIdentity.projectId },
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
      runtimeIdentity.projectId,
    );
    expect(ctx.askingService.createAskingTask).toHaveBeenCalledWith(
      { question: 'What happened?' },
      expect.objectContaining({
        language: 'English',
      }),
    );
  });

  it('validates task scope before creating a follow-up response from an asking task', async () => {
    const resolver = new AskingResolver();
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
    const resolver = new AskingResolver();
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
    const resolver = new AskingResolver();
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

  it('passes runtime scope when generating thread recommended questions', async () => {
    const resolver = new AskingResolver();
    const ctx = createContext();

    await resolver.generateThreadRecommendationQuestions(
      null,
      { threadId: 12 },
      ctx,
    );

    expect(ctx.askingService.assertThreadScope).toHaveBeenCalledWith(
      12,
      runtimeIdentity,
    );
    expect(
      ctx.askingService.generateThreadRecommendationQuestions,
    ).toHaveBeenCalledWith(12, 'runtime-scope-1');
  });

  it('scopes instant recommended questions lookup to the active runtime identity', async () => {
    const resolver = new AskingResolver();
    const ctx = createContext();

    await resolver.getInstantRecommendedQuestions(
      null,
      { taskId: 'instant-1' },
      ctx,
    );

    expect(
      ctx.askingService.getInstantRecommendedQuestions,
    ).toHaveBeenCalledWith('instant-1', runtimeIdentity);
  });

  it('hides candidate views and sql pairs outside the active project', async () => {
    const resolver = new AskingResolver();
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
    expect(result.candidates).toEqual([
      expect.objectContaining({
        view: null,
        sqlPair: null,
      }),
    ]);
  });

  it('returns null for thread response view outside the active project', async () => {
    const resolver = new AskingResolver();
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
    const resolver = new AskingResolver();
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
    const resolver = new AskingResolver();
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
