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
        project: { id: runtimeIdentity.projectId, language: 'EN' },
        workspace: { id: runtimeIdentity.workspaceId },
        knowledgeBase: { id: runtimeIdentity.knowledgeBaseId },
        kbSnapshot: { id: runtimeIdentity.kbSnapshotId },
        deployHash: runtimeIdentity.deployHash,
        userId: runtimeIdentity.actorUserId,
      },
      telemetry: { sendEvent: jest.fn() },
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
        createThread: jest.fn().mockResolvedValue({ id: 99 }),
        createThreadResponse: jest.fn().mockResolvedValue({ id: 199 }),
        createThreadResponseScoped: jest.fn().mockResolvedValue({ id: 199 }),
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
        cancelAdjustThreadResponseAnswer: jest.fn().mockResolvedValue(undefined),
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

    await resolver.createThread(
      null,
      { data: { taskId: 'task-1' } },
      ctx,
    );

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
    ).toHaveBeenCalledWith({ previousQuestions: ['q0'] }, runtimeIdentity);
  });

  it('scopes instant recommended questions lookup to the active runtime identity', async () => {
    const resolver = new AskingResolver();
    const ctx = createContext();

    await resolver.getInstantRecommendedQuestions(
      null,
      { taskId: 'instant-1' },
      ctx,
    );

    expect(ctx.askingService.getInstantRecommendedQuestions).toHaveBeenCalledWith(
      'instant-1',
      runtimeIdentity,
    );
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
      sqlPairRepository: {
        findOneBy: jest.fn().mockResolvedValue({
          id: 20,
          projectId: 99,
          question: 'foreign',
          sql: 'select 2',
        }),
      },
    });

    const result = await resolver.getAskingTask(null, { taskId: 'task-1' }, ctx);

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
      viewRepository: {
        findOneBy: jest.fn().mockResolvedValue({
          id: 10,
          projectId: 99,
          name: 'foreign_view',
          properties: JSON.stringify({ displayName: 'Foreign' }),
        }),
      },
    });

    const nested = resolver.getThreadResponseNestedResolver();
    const result = await nested.view({ viewId: 10 } as any, null, ctx);

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
