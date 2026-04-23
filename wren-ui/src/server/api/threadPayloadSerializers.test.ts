import {
  AskResultStatus,
  AskResultType,
  ChartStatus,
} from '@server/models/adaptor';
import { ThreadResponseAnswerStatus } from '@server/services/askingServiceShared';
import { serializeThreadResponsePayload } from './threadPayloadSerializers';

describe('threadPayloadSerializers thinking contract', () => {
  const runtimeIdentity = {
    projectId: 1,
    workspaceId: 'workspace-1',
    knowledgeBaseId: 'kb-1',
    kbSnapshotId: 'snapshot-1',
    deployHash: 'deploy-1',
    actorUserId: 'user-1',
  };

  it('adds server-side ask thinking metadata to serialized responses', async () => {
    const payload = await serializeThreadResponsePayload({
      response: {
        id: 11,
        threadId: 7,
        question: '各部门平均薪资是多少？',
        sql: 'select * from salaries',
        askingTaskId: 21,
        answerDetail: {
          queryId: 'answer-1',
          status: ThreadResponseAnswerStatus.FINISHED,
          numRowsUsedInLLM: 9,
          content: '好的',
        },
      } as any,
      runtimeIdentity,
      services: {
        askingService: {
          getAskingTaskById: jest.fn().mockResolvedValue({
            queryId: 'ask-1',
            question: '各部门平均薪资是多少？',
            type: AskResultType.TEXT_TO_SQL,
            status: AskResultStatus.FINISHED,
            error: null,
            response: [{ type: 'LLM', sql: 'select * from salaries' }],
            retrievedTables: ['departments', 'salaries'],
            sqlGenerationReasoning: '先识别部门，再聚合平均薪资。',
            thinking: {
              currentStepKey: null,
              steps: [
                {
                  key: 'ask.sql_pairs_retrieved',
                  messageKey: 'ask.sql_pairs_retrieved',
                  messageParams: { count: 1 },
                  status: 'finished',
                },
                {
                  key: 'ask.sql_instructions_retrieved',
                  messageKey: 'ask.sql_instructions_retrieved',
                  messageParams: { count: 2 },
                  status: 'finished',
                },
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
                  tags: ['departments', 'salaries'],
                },
                {
                  key: 'ask.sql_reasoned',
                  messageKey: 'ask.sql_reasoned',
                  status: 'finished',
                  detail: '先识别部门，再聚合平均薪资。',
                },
                {
                  key: 'ask.sql_generated',
                  messageKey: 'ask.sql_generated',
                  messageParams: { correcting: false, retries: 0 },
                  status: 'finished',
                },
              ],
            },
          }),
          getAdjustmentTaskById: jest.fn().mockResolvedValue(null),
        },
      },
    });

    expect(payload.askingTask?.thinking?.steps.map((step) => step.key)).toEqual(
      [
        'ask.sql_pairs_retrieved',
        'ask.sql_instructions_retrieved',
        'ask.intent_recognized',
        'ask.candidate_models_selected',
        'ask.sql_reasoned',
        'ask.sql_generated',
        'ask.data_fetched',
        'ask.answer_instructions_retrieved',
        'ask.answer_generated',
      ],
    );
    expect(payload.askingTask?.thinking?.steps[1]).toMatchObject({
      key: 'ask.sql_instructions_retrieved',
      status: 'finished',
      messageParams: { count: 2 },
    });
    expect(payload.askingTask?.thinking?.steps[3]).toMatchObject({
      key: 'ask.candidate_models_selected',
      status: 'finished',
      messageParams: { count: 2 },
      tags: ['departments', 'salaries'],
    });
    expect(payload.askingTask?.thinking?.steps[6]).toMatchObject({
      key: 'ask.data_fetched',
      status: 'finished',
      messageParams: { rows: 9 },
    });
    expect(payload.askingTask?.thinking?.steps[7]).toMatchObject({
      key: 'ask.answer_instructions_retrieved',
      status: 'finished',
      messageParams: { count: 0 },
    });
    expect(payload.resolvedIntent).toMatchObject({
      kind: 'ASK',
      mode: 'NEW',
      source: 'classifier',
      target: 'THREAD_RESPONSE',
      sourceThreadId: 7,
      sourceResponseId: null,
      artifactPlan: {
        teaserArtifacts: ['preview_teaser'],
        workbenchArtifacts: ['preview', 'sql'],
        primaryTeaser: 'preview_teaser',
        primaryWorkbenchArtifact: 'preview',
      },
      conversationAidPlan: {
        responseAids: [
          { kind: 'TRIGGER_CHART_FOLLOWUP', sourceResponseId: 11 },
          { kind: 'TRIGGER_RECOMMEND_QUESTIONS', sourceResponseId: 11 },
        ],
      },
    });
    expect(payload.artifactLineage).toBeNull();
    expect(payload).toMatchObject({
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
    });
  });

  it('adds server-side chart thinking metadata to serialized responses', async () => {
    const payload = await serializeThreadResponsePayload({
      response: {
        id: 12,
        threadId: 7,
        question: '生成图表',
        responseKind: 'CHART_FOLLOWUP',
        sourceResponseId: 11,
        sql: 'select * from salaries',
        chartDetail: {
          status: ChartStatus.FINISHED,
          chartType: 'BAR',
          chartSchema: { mark: 'bar', encoding: {} },
          description: '条形图更适合比较不同部门之间的数值差异。',
          canonicalizationVersion: 'chart-canonical-v1',
          diagnostics: {
            previewColumnCount: 4,
            previewRowCount: 9,
            previewColumns: [
              { name: 'dept_name', type: 'VARCHAR' },
              { name: 'salary_difference', type: 'DOUBLE' },
            ],
          },
        },
      } as any,
      runtimeIdentity,
      services: {
        askingService: {
          getAskingTaskById: jest.fn().mockResolvedValue(null),
          getAdjustmentTaskById: jest.fn().mockResolvedValue(null),
        },
      },
    });

    expect(
      payload.chartDetail?.thinking?.steps.map((step) => step.key),
    ).toEqual([
      'chart.sql_pairs_retrieved',
      'chart.sql_instructions_retrieved',
      'chart.preview_data_fetched',
      'chart.intent_recognized',
      'chart.chart_instructions_retrieved',
      'chart.chart_intent_detected',
      'chart.chart_type_selected',
      'chart.chart_generated',
      'chart.chart_validated',
    ]);
    expect(payload.chartDetail?.thinking?.steps[0]).toMatchObject({
      key: 'chart.sql_pairs_retrieved',
      status: 'finished',
      messageParams: { count: 0 },
    });
    expect(payload.chartDetail?.thinking?.steps[2]).toMatchObject({
      key: 'chart.preview_data_fetched',
      status: 'finished',
      messageParams: { rows: 9, columns: 4 },
    });
    expect(payload.chartDetail?.thinking?.steps[6]).toMatchObject({
      key: 'chart.chart_type_selected',
      status: 'finished',
      messageParams: { chartType: 'BAR' },
      detail: '条形图更适合比较不同部门之间的数值差异。',
    });
    expect(payload.resolvedIntent).toMatchObject({
      kind: 'CHART',
      mode: 'FOLLOW_UP',
      artifactPlan: {
        teaserArtifacts: ['chart_teaser'],
        workbenchArtifacts: ['chart', 'preview', 'sql'],
        primaryTeaser: 'chart_teaser',
        primaryWorkbenchArtifact: 'chart',
      },
      conversationAidPlan: {
        responseAids: [
          { kind: 'TRIGGER_CHART_REFINE', sourceResponseId: 12 },
          { kind: 'TRIGGER_CHART_REFINE', sourceResponseId: 12 },
          { kind: 'TRIGGER_CHART_REFINE', sourceResponseId: 12 },
          { kind: 'TRIGGER_RECOMMEND_QUESTIONS', sourceResponseId: 12 },
        ],
      },
    });
  });

  it('prefers persisted chart thinking metadata when present', async () => {
    const persistedThinking = {
      currentStepKey: 'chart.chart_generated',
      steps: [
        {
          key: 'chart.preview_data_fetched',
          messageKey: 'chart.preview_data_fetched',
          messageParams: { rows: 9, columns: 4 },
          status: 'finished',
        },
        {
          key: 'chart.chart_generated',
          messageKey: 'chart.chart_generated',
          status: 'running',
        },
      ],
    };

    const payload = await serializeThreadResponsePayload({
      response: {
        id: 13,
        threadId: 7,
        question: '继续生成图表',
        chartDetail: {
          status: ChartStatus.GENERATING,
          thinking: persistedThinking,
          diagnostics: {
            previewColumnCount: 4,
            previewRowCount: 9,
          },
        },
      } as any,
      runtimeIdentity,
      services: {
        askingService: {
          getAskingTaskById: jest.fn().mockResolvedValue(null),
          getAdjustmentTaskById: jest.fn().mockResolvedValue(null),
        },
      },
    });

    expect(payload.chartDetail?.thinking).toEqual(persistedThinking);
    expect(payload.resolvedIntent).toMatchObject({
      kind: 'ASK',
      mode: 'NEW',
      artifactPlan: {
        teaserArtifacts: [],
        workbenchArtifacts: [],
        primaryTeaser: null,
        primaryWorkbenchArtifact: null,
      },
    });
  });

  it('serializes chart follow-up lineage and artifact plan', async () => {
    const payload = await serializeThreadResponsePayload({
      response: {
        id: 14,
        threadId: 7,
        question: '生成一张图表给我',
        responseKind: 'CHART_FOLLOWUP',
        sourceResponseId: 11,
        sql: 'select * from salaries',
        chartDetail: {
          status: ChartStatus.FINISHED,
          chartSchema: { mark: 'bar' },
        },
      } as any,
      runtimeIdentity,
      services: {
        askingService: {
          getAskingTaskById: jest.fn().mockResolvedValue(null),
          getAdjustmentTaskById: jest.fn().mockResolvedValue(null),
        },
      },
    });

    expect(payload.resolvedIntent).toMatchObject({
      kind: 'CHART',
      mode: 'FOLLOW_UP',
      source: 'derived',
      sourceResponseId: 11,
      artifactPlan: {
        teaserArtifacts: ['chart_teaser'],
        workbenchArtifacts: ['chart', 'preview', 'sql'],
        primaryTeaser: 'chart_teaser',
        primaryWorkbenchArtifact: 'chart',
      },
    });
    expect(payload.artifactLineage).toEqual({
      sourceResponseId: 11,
      inheritedWorkbenchArtifacts: ['preview', 'sql'],
    });
  });

  it('refreshes persisted chart follow-up artifact plans when the chart becomes available', async () => {
    const payload = await serializeThreadResponsePayload({
      response: {
        id: 15,
        threadId: 7,
        question: '生成一张图表给我',
        responseKind: 'CHART_FOLLOWUP',
        sourceResponseId: 11,
        sql: 'select * from salaries',
        resolvedIntent: {
          kind: 'CHART',
          mode: 'FOLLOW_UP',
          target: 'THREAD_RESPONSE',
          source: 'explicit',
          sourceThreadId: 7,
          sourceResponseId: 11,
          artifactPlan: {
            teaserArtifacts: ['chart_teaser'],
            workbenchArtifacts: ['preview', 'sql'],
            primaryTeaser: 'chart_teaser',
            primaryWorkbenchArtifact: 'preview',
          },
          conversationAidPlan: null,
        },
        artifactLineage: {
          sourceResponseId: 11,
          inheritedWorkbenchArtifacts: ['preview', 'sql'],
        },
        chartDetail: {
          status: ChartStatus.FINISHED,
          chartSchema: { mark: 'bar' },
        },
      } as any,
      runtimeIdentity,
      services: {
        askingService: {
          getAskingTaskById: jest.fn().mockResolvedValue(null),
          getAdjustmentTaskById: jest.fn().mockResolvedValue(null),
        },
      },
    });

    expect(payload.resolvedIntent).toMatchObject({
      kind: 'CHART',
      mode: 'FOLLOW_UP',
      source: 'explicit',
      sourceResponseId: 11,
      artifactPlan: {
        teaserArtifacts: ['chart_teaser'],
        workbenchArtifacts: ['chart', 'preview', 'sql'],
        primaryTeaser: 'chart_teaser',
        primaryWorkbenchArtifact: 'chart',
      },
    });
    expect(payload.artifactLineage).toEqual({
      sourceResponseId: 11,
      inheritedWorkbenchArtifacts: ['preview', 'sql'],
    });
  });
});
