import {
  ThreadResponseAdjustmentType,
  ThreadResponseRepository,
} from './threadResponseRepository';
import { SkillResultType } from '@server/models/adaptor';

const buildRepository = () =>
  new ThreadResponseRepository((jest.fn() as unknown) as any);

const buildKnexRows = (rows: any[]) => {
  const builder: any = {
    select: jest.fn(() => builder),
    where: jest.fn(() => builder),
    leftJoin: jest.fn(() => builder),
    orderBy: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    then: (resolve: (value: any[]) => unknown, reject?: (reason: any) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };

  const knex = jest.fn(() => builder);
  return { knex, builder };
};

describe('ThreadResponseRepository skillResult persistence', () => {
  it('serializes skillResult and other JSON columns into snake_case DB payloads', () => {
    const repository = buildRepository();

    expect((repository as any).transformToDBData({
      threadId: 1,
      question: '本月 GMV 是多少？',
      skillResult: {
        resultType: SkillResultType.TEXT,
        text: '本月 GMV 为 128 万',
        metadata: { source: 'skill' },
        trace: {
          skillRunId: 'run-1',
          runnerJobId: 'job-1',
        },
      },
      adjustment: {
        type: ThreadResponseAdjustmentType.REASONING,
        payload: {
          originalThreadResponseId: 11,
          retrievedTables: ['orders'],
        },
      },
    })).toEqual({
      thread_id: 1,
      question: '本月 GMV 是多少？',
      skill_result: JSON.stringify({
        resultType: SkillResultType.TEXT,
        text: '本月 GMV 为 128 万',
        metadata: { source: 'skill' },
        trace: {
          skillRunId: 'run-1',
          runnerJobId: 'job-1',
        },
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

  it('parses skillResult and null JSON values when reading DB rows', () => {
    const repository = buildRepository();

    expect(
      (repository as any).transformFromDBData({
        id: 21,
        thread_id: 1,
        question: '技能回答',
        skill_result: JSON.stringify({
          resultType: SkillResultType.TABULAR_FRAME,
          rows: [{ metric: 'gmv', value: 128 }],
        }),
        answer_detail: JSON.stringify({
          status: 'FINISHED',
          content: '改用文本回答',
        }),
        adjustment: 'null',
      }),
    ).toEqual({
      id: 21,
      threadId: 1,
      question: '技能回答',
      skillResult: {
        resultType: SkillResultType.TABULAR_FRAME,
        rows: [{ metric: 'gmv', value: 128 }],
      },
      answerDetail: {
        status: 'FINISHED',
        content: '改用文本回答',
      },
      adjustment: null,
    });
  });

  it('getResponsesWithThread rehydrates skillResult payloads from joined rows', async () => {
    const { knex, builder } = buildKnexRows([
      {
        id: 22,
        thread_id: 1,
        question: '本月 GMV',
        skill_result: JSON.stringify({
          resultType: SkillResultType.TEXT,
          text: '128 万',
        }),
        adjustment: null,
      },
    ]);
    const repository = new ThreadResponseRepository((knex as unknown) as any);

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
        answerDetail: null,
        breakdownDetail: null,
        chartDetail: null,
        skillResult: {
          resultType: SkillResultType.TEXT,
          text: '128 万',
        },
        adjustment: null,
      },
    ]);
  });
});
