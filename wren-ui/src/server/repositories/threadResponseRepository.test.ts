import { AskResultStatus } from '@server/models/adaptor';
import {
  ThreadResponseAdjustmentType,
  ThreadResponseRepository,
} from './threadResponseRepository';

const buildRepository = () =>
  new ThreadResponseRepository(jest.fn() as unknown as any);

const buildKnexRows = (rows: any[]) => {
  const builder: any = {
    select: jest.fn(() => builder),
    where: jest.fn(() => builder),
    whereIn: jest.fn(() => builder),
    leftJoin: jest.fn(() => builder),
    whereNotNull: jest.fn(() => builder),
    whereRaw: jest.fn(() => builder),
    andWhereRaw: jest.fn(() => builder),
    orderBy: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    update: jest.fn(() => builder),
    returning: jest.fn().mockResolvedValue(rows),
    first: jest.fn().mockResolvedValue(rows[0] ?? null),
    then: (
      resolve: (value: any[]) => unknown,
      reject?: (reason: any) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };

  const knex = jest.fn(() => builder);
  return { knex, builder };
};

describe('ThreadResponseRepository', () => {
  it('serializes JSON columns into snake_case DB payloads', () => {
    const repository = buildRepository();

    expect(
      (repository as any).transformToDBData({
        threadId: 1,
        question: '本月 GMV 是多少？',
        answerDetail: {
          status: 'FINISHED',
          content: '本月 GMV 为 128 万',
        },
        adjustment: {
          type: ThreadResponseAdjustmentType.REASONING,
          payload: {
            originalThreadResponseId: 11,
            retrievedTables: ['orders'],
          },
        },
      }),
    ).toEqual({
      thread_id: 1,
      question: '本月 GMV 是多少？',
      answer_detail: JSON.stringify({
        status: 'FINISHED',
        content: '本月 GMV 为 128 万',
      }),
      adjustment: JSON.stringify({
        type: ThreadResponseAdjustmentType.REASONING,
        payload: {
          originalThreadResponseId: 11,
          retrievedTables: ['orders'],
        },
      }),
    });
  });

  it('parses answerDetail and null JSON values when reading DB rows', () => {
    const repository = buildRepository();

    expect(
      (repository as any).transformFromDBData({
        id: 21,
        thread_id: 1,
        question: '文本回答',
        answer_detail: JSON.stringify({
          status: 'FINISHED',
          content: '改用文本回答',
        }),
        adjustment: 'null',
      }),
    ).toEqual({
      id: 21,
      threadId: 1,
      question: '文本回答',
      answerDetail: {
        status: 'FINISHED',
        content: '改用文本回答',
      },
      adjustment: null,
    });
  });

  it('getResponsesWithThread rehydrates JSON payloads from joined rows', async () => {
    const { knex, builder } = buildKnexRows([
      {
        id: 22,
        thread_id: 1,
        question: '本月 GMV',
        answer_detail: JSON.stringify({
          status: 'FINISHED',
          content: '128 万',
        }),
        adjustment: null,
      },
    ]);
    const repository = new ThreadResponseRepository(knex as unknown as any);

    const responses = await repository.getResponsesWithThread(1, 5);

    expect(knex).toHaveBeenCalledWith('thread_response');
    expect(builder.select).toHaveBeenCalledWith('thread_response.*');
    expect(builder.where).toHaveBeenCalledWith({ thread_id: 1 });
    expect(builder.leftJoin).toHaveBeenCalledWith(
      'thread',
      'thread.id',
      'thread_response.thread_id',
    );
    expect(builder.orderBy).toHaveBeenCalledWith('created_at', 'desc');
    expect(builder.limit).toHaveBeenCalledWith(5);
    expect(responses).toEqual([
      {
        id: 22,
        threadId: 1,
        question: '本月 GMV',
        answerDetail: {
          status: 'FINISHED',
          content: '128 万',
        },
        breakdownDetail: null,
        chartDetail: null,
        adjustment: null,
      },
    ]);
  });

  it('getResponsesWithThread orders full thread history chronologically when limit is omitted', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new ThreadResponseRepository(knex as unknown as any);

    await repository.getResponsesWithThread(1);

    expect(builder.orderBy).toHaveBeenCalledWith('created_at', 'asc');
    expect(builder.limit).not.toHaveBeenCalled();
  });

  it('getResponsesWithThreadByScope requires exact runtime scope matches', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new ThreadResponseRepository(knex as unknown as any);

    await repository.getResponsesWithThreadByScope(
      101,
      {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      },
      5,
    );

    expect(builder.andWhereRaw).toHaveBeenCalledWith(
      'COALESCE(thread_response.project_id, thread.project_id) = ?',
      [42],
    );
    expect(builder.andWhereRaw).toHaveBeenCalledWith(
      'COALESCE(thread_response.workspace_id, thread.workspace_id) = ?',
      ['workspace-1'],
    );
    expect(builder.where).toHaveBeenCalledWith(
      'thread_response.thread_id',
      101,
    );
    expect(builder.orderBy).toHaveBeenCalledWith(
      'thread_response.created_at',
      'desc',
    );
    expect(builder.limit).toHaveBeenCalledWith(5);
  });

  it('getResponsesWithThreadByScope orders full runtime-scoped history chronologically when limit is omitted', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new ThreadResponseRepository(knex as unknown as any);

    await repository.getResponsesWithThreadByScope(101, {
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
    });

    expect(builder.orderBy).toHaveBeenCalledWith(
      'thread_response.created_at',
      'asc',
    );
    expect(builder.limit).not.toHaveBeenCalled();
  });

  it('findOneByIdWithRuntimeScope requires null project scope when runtime project is null', async () => {
    const { knex, builder } = buildKnexRows([null]);
    const repository = new ThreadResponseRepository(knex as unknown as any);

    await repository.findOneByIdWithRuntimeScope(202, {
      projectId: null,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
    });

    expect(builder.andWhereRaw).toHaveBeenCalledWith(
      'COALESCE(thread_response.project_id, thread.project_id) IS NULL',
    );
    expect(builder.where).toHaveBeenCalledWith('thread_response.id', 202);
    expect(builder.first).toHaveBeenCalled();
  });

  it('skips null project filtering when canonical runtime scope is present', async () => {
    const { knex, builder } = buildKnexRows([null]);
    const repository = new ThreadResponseRepository(knex as unknown as any);

    await repository.findOneByIdWithRuntimeScope(202, {
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: null,
      deployHash: null,
    });

    expect(builder.andWhereRaw).not.toHaveBeenCalledWith(
      'COALESCE(thread_response.project_id, thread.project_id) IS NULL',
    );
    expect(builder.where).toHaveBeenCalledWith('thread_response.id', 202);
  });

  it('findUnfinishedBreakdownResponsesByWorkspaceId narrows bootstrap reads to one workspace', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new ThreadResponseRepository(knex as unknown as any);

    await repository.findUnfinishedBreakdownResponsesByWorkspaceId(
      'workspace-1',
    );

    expect(builder.whereNotNull).toHaveBeenCalledWith('breakdown_detail');
    expect(builder.whereRaw).toHaveBeenCalledWith(
      `COALESCE(thread_response.workspace_id, thread.workspace_id) = ?`,
      ['workspace-1'],
    );
    expect(builder.whereRaw).toHaveBeenCalledWith(
      `COALESCE(breakdown_detail->>'status', '') NOT IN (?, ?, ?)`,
      [
        AskResultStatus.FAILED,
        AskResultStatus.FINISHED,
        AskResultStatus.STOPPED,
      ],
    );
  });

  it('findUnfinishedBreakdownResponses rehydrates unfinished rows across workspaces without forcing a workspace predicate', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new ThreadResponseRepository(knex as unknown as any);

    await repository.findUnfinishedBreakdownResponses();

    expect(builder.whereNotNull).toHaveBeenCalledWith('breakdown_detail');
    expect(builder.whereRaw).not.toHaveBeenCalledWith(
      `COALESCE(thread_response.workspace_id, thread.workspace_id) = ?`,
      expect.anything(),
    );
    expect(builder.whereRaw).toHaveBeenCalledWith(
      `COALESCE(breakdown_detail->>'status', '') NOT IN (?, ?, ?)`,
      [
        AskResultStatus.FAILED,
        AskResultStatus.FINISHED,
        AskResultStatus.STOPPED,
      ],
    );
  });

  it('findUnfinishedChartResponses can narrow adjustment chart jobs separately', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new ThreadResponseRepository(knex as unknown as any);

    await repository.findUnfinishedChartResponses({ adjustment: true });

    expect(builder.whereNotNull).toHaveBeenCalledWith('chart_detail');
    expect(builder.whereRaw).toHaveBeenCalledWith(
      `COALESCE(chart_detail->>'status', '') NOT IN (?, ?, ?)`,
      [
        AskResultStatus.FAILED,
        AskResultStatus.FINISHED,
        AskResultStatus.STOPPED,
      ],
    );
    expect(builder.whereRaw).toHaveBeenCalledWith(
      `COALESCE(chart_detail->>'adjustment', 'false') = 'true'`,
    );
  });

  it('updateOneByIdWithRuntimeScope constrains updates by coalesced runtime scope', async () => {
    const { knex, builder } = buildKnexRows([{ id: 21, question: 'hi' }]);
    const repository = new ThreadResponseRepository(knex as unknown as any);

    await repository.updateOneByIdWithRuntimeScope(
      21,
      {
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      },
      {
        breakdownDetail: {
          queryId: 'ask-1',
          status: AskResultStatus.GENERATING,
        },
      },
    );

    expect(builder.where).toHaveBeenCalledWith('thread_response.id', 21);
    expect(builder.andWhereRaw).toHaveBeenCalledWith(
      'COALESCE(thread_response.workspace_id, thread.workspace_id) = ?',
      ['workspace-1'],
    );
    expect(builder.whereIn).toHaveBeenCalledWith('id', builder);
    expect(builder.update).toHaveBeenCalled();
  });
});
