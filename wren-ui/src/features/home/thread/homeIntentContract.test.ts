import {
  hydrateThreadResponseHomeIntent,
  hydrateThreadResponsesHomeIntent,
  resolveDefaultArtifactPlanForIntent,
  resolveDefaultConversationAidPlanForIntent,
  resolveRecommendedQuestionsHomeIntent,
  resolveResponseArtifactLineage,
  resolveResponseArtifactPlan,
  resolveResponseHomeIntent,
} from './homeIntentContract';

describe('homeIntentContract', () => {
  it('builds chart follow-up artifact plan with inherited preview/sql tabs', () => {
    const response = {
      id: 18,
      threadId: 3,
      responseKind: 'CHART_FOLLOWUP',
      sourceResponseId: 8,
      sql: 'select * from employees',
      chartDetail: {
        status: 'FINISHED',
        chartSchema: { mark: 'bar' },
      },
    };

    expect(resolveResponseArtifactPlan(response)).toEqual({
      teaserArtifacts: ['chart_teaser'],
      workbenchArtifacts: ['chart', 'preview', 'sql'],
      primaryTeaser: 'chart_teaser',
      primaryWorkbenchArtifact: 'chart',
    });
    expect(resolveResponseArtifactLineage(response)).toEqual({
      sourceResponseId: 8,
      inheritedWorkbenchArtifacts: ['preview', 'sql'],
    });
    expect(resolveResponseHomeIntent(response)).toMatchObject({
      kind: 'CHART',
      mode: 'FOLLOW_UP',
      target: 'THREAD_RESPONSE',
      sourceThreadId: 3,
      sourceResponseId: 8,
      conversationAidPlan: {
        responseAids: [
          { kind: 'TRIGGER_CHART_REFINE', sourceResponseId: 18 },
          { kind: 'TRIGGER_CHART_REFINE', sourceResponseId: 18 },
          { kind: 'TRIGGER_CHART_REFINE', sourceResponseId: 18 },
          {
            kind: 'TRIGGER_RECOMMEND_QUESTIONS',
            sourceResponseId: 18,
            suggestedIntent: 'RECOMMEND_QUESTIONS',
          },
        ],
      },
    });
  });

  it('maps general ask results to general-help intent without workbench artifacts', () => {
    const response = {
      threadId: 4,
      askingTask: {
        type: 'GENERAL',
      },
      answerDetail: {
        status: 'FINISHED',
      },
    };

    expect(resolveResponseArtifactPlan(response)).toEqual({
      teaserArtifacts: [],
      workbenchArtifacts: [],
      primaryTeaser: null,
      primaryWorkbenchArtifact: null,
    });
    expect(resolveResponseHomeIntent(response)).toMatchObject({
      kind: 'GENERAL_HELP',
      mode: 'NEW',
      source: 'classifier',
      conversationAidPlan: null,
    });
  });

  it('exposes canonical default artifact plans and aids for composer/runtime handoff', () => {
    expect(resolveDefaultArtifactPlanForIntent('ASK')).toEqual({
      teaserArtifacts: ['preview_teaser'],
      workbenchArtifacts: ['preview', 'sql'],
      primaryTeaser: 'preview_teaser',
      primaryWorkbenchArtifact: 'preview',
    });

    expect(resolveDefaultArtifactPlanForIntent('CHART')).toEqual({
      teaserArtifacts: ['chart_teaser'],
      workbenchArtifacts: ['chart', 'preview', 'sql'],
      primaryTeaser: 'chart_teaser',
      primaryWorkbenchArtifact: 'chart',
    });

    expect(
      resolveDefaultConversationAidPlanForIntent('ASK', { id: 11 }),
    ).toMatchObject({
      responseAids: [
        {
          kind: 'TRIGGER_CHART_FOLLOWUP',
          sourceResponseId: 11,
          suggestedIntent: 'CHART',
        },
        {
          kind: 'TRIGGER_RECOMMEND_QUESTIONS',
          sourceResponseId: 11,
          suggestedIntent: 'RECOMMEND_QUESTIONS',
        },
      ],
    });
  });

  it('hydrates unresolved responses with resolvedIntent and lineage', () => {
    const response = {
      id: 21,
      threadId: 6,
      question: '生成图表',
      responseKind: 'CHART_FOLLOWUP',
      sourceResponseId: 9,
      sql: 'select * from salaries',
      chartDetail: {
        status: 'FINISHED',
        chartSchema: { mark: 'line' },
      },
    };

    expect(hydrateThreadResponseHomeIntent(response)).toMatchObject({
      id: 21,
      resolvedIntent: {
        kind: 'CHART',
        mode: 'FOLLOW_UP',
        sourceThreadId: 6,
        sourceResponseId: 9,
        artifactPlan: {
          primaryWorkbenchArtifact: 'chart',
        },
      },
      artifactLineage: {
        sourceResponseId: 9,
        inheritedWorkbenchArtifacts: ['preview', 'sql'],
      },
    });
  });

  it('hydrates response collections without mutating resolved entries', () => {
    const hydratedResponses = hydrateThreadResponsesHomeIntent([
      {
        id: 11,
        threadId: 3,
        question: '平均薪资',
        sql: 'select * from salaries',
      },
      {
        id: 12,
        threadId: 3,
        question: '生成图表',
        responseKind: 'CHART_FOLLOWUP',
        sourceResponseId: 11,
        resolvedIntent: {
          kind: 'CHART',
          mode: 'FOLLOW_UP',
          target: 'THREAD_RESPONSE',
          source: 'derived',
          sourceThreadId: 3,
          sourceResponseId: 11,
          artifactPlan: {
            teaserArtifacts: ['chart_teaser'],
            workbenchArtifacts: ['chart', 'preview', 'sql'],
            primaryTeaser: 'chart_teaser',
            primaryWorkbenchArtifact: 'chart',
          },
          conversationAidPlan: null,
        },
        artifactLineage: {
          sourceResponseId: 11,
          inheritedWorkbenchArtifacts: ['preview', 'sql'],
        },
      },
    ]);

    expect(hydratedResponses[0].resolvedIntent).toMatchObject({
      kind: 'ASK',
      artifactPlan: {
        primaryWorkbenchArtifact: 'preview',
        teaserArtifacts: ['preview_teaser'],
      },
      conversationAidPlan: {
        responseAids: [
          { kind: 'TRIGGER_CHART_FOLLOWUP', sourceResponseId: 11 },
          { kind: 'TRIGGER_RECOMMEND_QUESTIONS', sourceResponseId: 11 },
        ],
      },
    });
    expect(hydratedResponses[1].resolvedIntent).toMatchObject({
      kind: 'CHART',
      sourceResponseId: 11,
    });
  });

  it('builds canonical intent metadata for thread-level recommended questions', () => {
    expect(
      resolveRecommendedQuestionsHomeIntent({
        sourceThreadId: 3,
        sourceResponseId: 11,
      }),
    ).toEqual({
      kind: 'RECOMMEND_QUESTIONS',
      mode: 'FOLLOW_UP',
      target: 'THREAD_SIDECAR',
      source: 'derived',
      sourceThreadId: 3,
      sourceResponseId: 11,
      confidence: null,
      artifactPlan: {
        teaserArtifacts: [],
        workbenchArtifacts: [],
        primaryTeaser: null,
        primaryWorkbenchArtifact: null,
      },
      conversationAidPlan: {
        threadAids: ['suggested_questions'],
      },
    });
  });
});
