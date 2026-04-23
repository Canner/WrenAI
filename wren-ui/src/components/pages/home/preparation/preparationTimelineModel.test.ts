import {
  AskingTaskStatus,
  AskingTaskType,
  ChartTaskStatus,
  ThreadResponseAnswerStatus,
  ThreadResponseKind,
  type ThreadResponse,
} from '@/types/home';
import { resolvePreparationTimelineModel } from './preparationTimelineModel';
import type { PreparedTask } from './index';

const buildPreparedTask = (
  overrides: Partial<PreparedTask> = {},
): PreparedTask => ({
  candidates: [],
  isAdjustment: false,
  queryId: 'ask-1',
  retrievedTables: ['orders', 'customers'],
  sqlGenerationReasoning: '先识别指标，再按部门聚合。',
  status: AskingTaskStatus.FINISHED,
  type: AskingTaskType.TEXT_TO_SQL,
  ...overrides,
});

const buildThreadResponse = (
  overrides: Partial<ThreadResponse> = {},
): ThreadResponse => ({
  answerDetail: null,
  askingTask: null,
  chartDetail: null,
  id: 1,
  question: '各部门平均薪资是多少？',
  threadId: 1,
  ...overrides,
});

describe('resolvePreparationTimelineModel', () => {
  it('builds detailed ask thinking steps for text-to-sql answers', () => {
    const preparedTask = buildPreparedTask();
    const model = resolvePreparationTimelineModel({
      askingStreamTask: '',
      data: buildThreadResponse({
        answerDetail: {
          content: '好的',
          numRowsUsedInLLM: 9,
          queryId: 'answer-1',
          status: ThreadResponseAnswerStatus.FINISHED,
        },
        sql: 'select * from orders',
      }),
      preparedTask,
    });

    expect(model).not.toBeNull();
    expect(model?.kind).toBe('ask');
    expect(model?.totalSteps).toBe(6);
    expect(model?.steps.map((step) => step.key)).toEqual([
      'intent',
      'models',
      'reasoning',
      'sql',
      'data',
      'answer',
    ]);
    expect(model?.steps[1]).toMatchObject({
      status: 'finished',
      title: '已匹配 2 个候选模型',
    });
    expect(model?.steps[4]).toMatchObject({
      status: 'finished',
      title: '已获取 9 行结果数据',
    });
  });

  it('falls back to a compact generic sequence for non-sql ask tasks', () => {
    const model = resolvePreparationTimelineModel({
      data: buildThreadResponse(),
      preparedTask: buildPreparedTask({
        retrievedTables: [],
        sqlGenerationReasoning: '',
        status: AskingTaskStatus.PLANNING,
        type: AskingTaskType.GENERAL,
      }),
    });

    expect(model?.kind).toBe('ask');
    expect(model?.totalSteps).toBe(3);
    expect(model?.steps[1]).toMatchObject({
      key: 'reasoning',
      status: 'running',
    });
  });

  it('prefers server-provided ask thinking steps when available', () => {
    const model = resolvePreparationTimelineModel({
      data: buildThreadResponse({
        answerDetail: {
          content: '好的',
          numRowsUsedInLLM: 9,
          queryId: 'answer-1',
          status: ThreadResponseAnswerStatus.FINISHED,
        },
        sql: 'select * from orders',
      }),
      preparedTask: buildPreparedTask({
        thinking: {
          steps: [
            {
              key: 'ask.intent_recognized',
              messageKey: 'ask.intent_recognized',
              status: 'finished',
            },
            {
              key: 'ask.candidate_models_selected',
              messageKey: 'ask.candidate_models_selected',
              messageParams: { count: 2 },
              status: 'finished',
              tags: ['orders', 'customers'],
            },
          ],
        },
      }),
    });

    expect(model?.kind).toBe('ask');
    expect(model?.totalSteps).toBe(2);
    expect(model?.steps[0]).toMatchObject({
      key: 'ask.intent_recognized',
      title: '已识别用户意图',
    });
    expect(model?.steps[1]).toMatchObject({
      key: 'ask.candidate_models_selected',
      title: '已匹配 2 个候选模型',
      tags: ['orders', 'customers'],
    });
  });

  it('renders sql pair and instruction retrieval labels for ask thinking', () => {
    const model = resolvePreparationTimelineModel({
      data: buildThreadResponse({
        answerDetail: {
          content: '好的',
          numRowsUsedInLLM: 9,
          queryId: 'answer-1',
          status: ThreadResponseAnswerStatus.FINISHED,
        },
      }),
      preparedTask: buildPreparedTask({
        thinking: {
          steps: [
            {
              key: 'ask.sql_pairs_retrieved',
              messageKey: 'ask.sql_pairs_retrieved',
              messageParams: { count: 2 },
              status: 'finished',
            },
            {
              key: 'ask.sql_instructions_retrieved',
              messageKey: 'ask.sql_instructions_retrieved',
              messageParams: { count: 1 },
              status: 'finished',
            },
          ],
        },
      }),
    });

    expect(model?.steps[0]).toMatchObject({
      key: 'ask.sql_pairs_retrieved',
      title: '已找到 2 条相关问答样例',
    });
    expect(model?.steps[1]).toMatchObject({
      key: 'ask.sql_instructions_retrieved',
      title: '已找到 1 条 SQL 指令',
    });
  });

  it('builds chart follow-up thinking steps from chart diagnostics', () => {
    const model = resolvePreparationTimelineModel({
      data: buildThreadResponse({
        chartDetail: {
          canonicalizationVersion: 'chart-canonical-v1',
          chartType: 'BAR' as any,
          description: '条形图更适合比较不同部门之间的数值差异。',
          diagnostics: {
            previewColumnCount: 4,
            previewColumns: [
              { name: 'dept_name', type: 'VARCHAR' },
              { name: 'salary_difference', type: 'DOUBLE' },
            ],
            previewRowCount: 9,
          },
          status: ChartTaskStatus.FINISHED,
          validationErrors: [],
        },
        question: '生成图表',
        responseKind: ThreadResponseKind.CHART_FOLLOWUP,
      }),
      preparedTask: null,
    });

    expect(model).not.toBeNull();
    expect(model?.kind).toBe('chart');
    expect(model?.totalSteps).toBe(9);
    expect(model?.steps.map((step) => step.key)).toEqual([
      'chart.sql_pairs_retrieved',
      'chart.sql_instructions_retrieved',
      'preview',
      'chart.intent_recognized',
      'chart.chart_instructions_retrieved',
      'intent',
      'chartType',
      'generation',
      'validation',
    ]);
    expect(model?.steps[0]).toMatchObject({
      status: 'finished',
      title: '未找到可复用的问答样例',
    });
    expect(model?.steps[2]).toMatchObject({
      status: 'finished',
      title: '已获取 9 行预览数据',
    });
    expect(model?.steps[6]).toMatchObject({
      status: 'finished',
      title: '已确定图表类型：柱状图',
    });
  });

  it('marks chart type selection as the failure step when preview data is not chartable', () => {
    const model = resolvePreparationTimelineModel({
      data: buildThreadResponse({
        chartDetail: {
          chartability: {
            chartable: false,
            message: '当前结果为空，暂时无法生成图表。',
            reasonCode: 'EMPTY_RESULT_SET',
          },
          diagnostics: {
            lastErrorCode: 'EMPTY_RESULT_SET',
            previewColumnCount: 4,
            previewColumns: [{ name: 'dept_name', type: 'VARCHAR' }],
            previewRowCount: 0,
          },
          error: {
            code: 'EMPTY_RESULT_SET',
            message: '当前结果为空，暂时无法生成图表。',
            shortMessage: '图表不可用',
          },
          status: ChartTaskStatus.FAILED,
          validationErrors: [],
        },
        question: '生成图表',
        responseKind: ThreadResponseKind.CHART_FOLLOWUP,
      }),
      preparedTask: null,
    });

    expect(model?.kind).toBe('chart');
    expect(model?.lifecycle).toBe('failed');
    expect(model?.steps[6]).toMatchObject({
      key: 'chartType',
      status: 'failed',
    });
    expect(model?.steps[8]).toMatchObject({
      key: 'validation',
      status: 'pending',
    });
  });

  it('prefers server-provided chart thinking steps when available', () => {
    const model = resolvePreparationTimelineModel({
      data: buildThreadResponse({
        chartDetail: {
          status: ChartTaskStatus.FINISHED,
          thinking: {
            steps: [
              {
                key: 'chart.preview_data_fetched',
                messageKey: 'chart.preview_data_fetched',
                messageParams: { rows: 9, columns: 4 },
                status: 'finished',
                tags: ['dept_name', 'salary_difference'],
              },
              {
                key: 'chart.chart_type_selected',
                messageKey: 'chart.chart_type_selected',
                messageParams: { chartType: 'BAR' },
                status: 'finished',
                detail: '条形图更适合比较不同部门之间的数值差异。',
              },
            ],
          },
        },
      }),
      preparedTask: null,
    });

    expect(model?.kind).toBe('chart');
    expect(model?.totalSteps).toBe(2);
    expect(model?.steps[0]).toMatchObject({
      key: 'chart.preview_data_fetched',
      title: '已获取 9 行预览数据',
      tags: ['dept_name', 'salary_difference'],
    });
    expect(model?.steps[1]).toMatchObject({
      key: 'chart.chart_type_selected',
      title: '已确定图表类型：柱状图',
      detailMarkdown: '条形图更适合比较不同部门之间的数值差异。',
    });
  });

  it('renders retrieval and chart-instruction labels for chart thinking', () => {
    const model = resolvePreparationTimelineModel({
      data: buildThreadResponse({
        chartDetail: {
          status: ChartTaskStatus.GENERATING,
          thinking: {
            steps: [
              {
                key: 'chart.sql_pairs_retrieved',
                messageKey: 'chart.sql_pairs_retrieved',
                messageParams: { count: 3 },
                status: 'finished',
              },
              {
                key: 'chart.sql_instructions_retrieved',
                messageKey: 'chart.sql_instructions_retrieved',
                messageParams: { count: 2 },
                status: 'finished',
              },
              {
                key: 'chart.chart_instructions_retrieved',
                messageKey: 'chart.chart_instructions_retrieved',
                messageParams: { count: 1 },
                status: 'finished',
              },
            ],
          },
        },
      }),
      preparedTask: null,
    });

    expect(model?.steps[0]).toMatchObject({
      key: 'chart.sql_pairs_retrieved',
      title: '已回看 3 条相关问答样例',
    });
    expect(model?.steps[1]).toMatchObject({
      key: 'chart.sql_instructions_retrieved',
      title: '已回看 2 条 SQL 指令',
    });
    expect(model?.steps[2]).toMatchObject({
      key: 'chart.chart_instructions_retrieved',
      title: '已加载 1 条图表指令',
    });
  });

  it('prefers chart preparation when resolved intent marks the response as chart follow-up', () => {
    const model = resolvePreparationTimelineModel({
      data: buildThreadResponse({
        chartDetail: {
          diagnostics: {
            previewColumnCount: 2,
            previewColumns: [{ name: 'dept_name', type: 'VARCHAR' }],
            previewRowCount: 9,
          },
          status: ChartTaskStatus.GENERATING,
        },
        resolvedIntent: {
          kind: 'CHART',
          mode: 'FOLLOW_UP',
          target: 'THREAD_RESPONSE',
          source: 'derived',
          sourceThreadId: 1,
          sourceResponseId: 99,
          confidence: null,
          artifactPlan: {
            teaserArtifacts: ['chart_teaser'],
            workbenchArtifacts: ['chart', 'preview', 'sql'],
            primaryTeaser: 'chart_teaser',
            primaryWorkbenchArtifact: 'chart',
          },
          conversationAidPlan: null,
        },
      }),
      preparedTask: buildPreparedTask({
        status: AskingTaskStatus.FINISHED,
        thinking: {
          steps: [
            {
              key: 'ask.intent_recognized',
              messageKey: 'ask.intent_recognized',
              status: 'finished',
            },
          ],
        },
      }),
    });

    expect(model?.kind).toBe('chart');
    expect(model?.steps[0]).toMatchObject({
      key: 'chart.sql_pairs_retrieved',
    });
  });
});
