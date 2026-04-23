import {
  resolveChartSourceResponse,
  resolveComposerIntent,
  shouldApplyComposerDraftIntent,
} from './homeIntentRouting';

describe('homeIntentRouting', () => {
  const responses = [
    {
      id: 11,
      threadId: 3,
      question: '各部门平均薪资是多少？',
      sql: 'select * from salaries',
      resolvedIntent: {
        kind: 'ASK',
        mode: 'NEW',
        target: 'THREAD_RESPONSE',
        source: 'classifier',
        artifactPlan: {
          teaserArtifacts: ['preview_teaser'],
          workbenchArtifacts: ['preview', 'sql'],
          primaryTeaser: 'preview_teaser',
          primaryWorkbenchArtifact: 'preview',
        },
      },
    },
    {
      id: 12,
      threadId: 3,
      question: '生成一张图表给我',
      responseKind: 'CHART_FOLLOWUP',
      sourceResponseId: 11,
      sql: 'select * from salaries',
      artifactLineage: {
        sourceResponseId: 11,
        inheritedWorkbenchArtifacts: ['preview', 'sql'],
      },
      resolvedIntent: {
        kind: 'CHART',
        mode: 'FOLLOW_UP',
        target: 'THREAD_RESPONSE',
        source: 'derived',
        sourceResponseId: 11,
        artifactPlan: {
          teaserArtifacts: ['chart_teaser'],
          workbenchArtifacts: ['chart', 'preview', 'sql'],
          primaryTeaser: 'chart_teaser',
          primaryWorkbenchArtifact: 'chart',
        },
      },
    },
  ] as any;

  it('maps selected chart follow-up back to its source answer', () => {
    expect(resolveChartSourceResponse(responses, 12)).toBe(11);
  });

  it('routes chart-only composer questions into chart intent when source exists', () => {
    expect(
      resolveComposerIntent({
        question: '生成一张图表给我',
        responses,
        selectedResponseId: 12,
      }),
    ).toMatchObject({
      sourceResponseId: 11,
      envelope: {
        entrypoint: 'composer',
        intentHint: 'CHART',
        sourceResponseId: 11,
        preferredWorkbenchArtifact: 'chart',
      },
      resolvedIntent: {
        kind: 'CHART',
        mode: 'FOLLOW_UP',
        target: 'THREAD_RESPONSE',
        sourceResponseId: 11,
        artifactPlan: {
          primaryWorkbenchArtifact: 'chart',
        },
      },
    });
  });

  it('keeps normal questions on ask intent', () => {
    expect(
      resolveComposerIntent({
        question: '继续解释一下这个结论',
        responses,
        selectedResponseId: 12,
      }),
    ).toMatchObject({
      sourceResponseId: 12,
      envelope: {
        entrypoint: 'composer',
        intentHint: 'ASK',
        sourceResponseId: 12,
        preferredWorkbenchArtifact: 'preview',
      },
      resolvedIntent: {
        kind: 'ASK',
        mode: 'FOLLOW_UP',
        target: 'THREAD_RESPONSE',
        sourceResponseId: 12,
        artifactPlan: {
          primaryWorkbenchArtifact: 'preview',
        },
      },
    });
  });

  it('routes recommend-only prompts into recommend intent', () => {
    expect(
      resolveComposerIntent({
        question: '推荐几个问题给我',
        responses,
        selectedResponseId: 11,
      }),
    ).toMatchObject({
      sourceResponseId: 11,
      envelope: {
        intentHint: 'RECOMMEND_QUESTIONS',
        sourceResponseId: 11,
      },
      resolvedIntent: {
        kind: 'RECOMMEND_QUESTIONS',
        target: 'THREAD_SIDECAR',
        sourceResponseId: 11,
      },
    });
  });

  it('uses draft metadata to preserve recommend routing after draft-to-composer', () => {
    expect(
      resolveComposerIntent({
        draftIntent: {
          draftKey: 'draft-1',
          draftedAt: new Date().toISOString(),
          draftedPrompt: '推荐几个问题给我',
          intentHint: 'RECOMMEND_QUESTIONS',
          sourceResponseId: 12,
          sourceAidKind: 'TRIGGER_RECOMMEND_QUESTIONS',
        },
        question: '推荐几个问题给我',
        responses,
        selectedResponseId: 12,
      }),
    ).toMatchObject({
      sourceResponseId: 12,
      resolvedIntent: {
        kind: 'RECOMMEND_QUESTIONS',
        sourceResponseId: 12,
      },
    });
  });

  it('uses draft metadata to keep chart refinements on the current chart response', () => {
    expect(
      resolveComposerIntent({
        draftIntent: {
          draftKey: 'draft-2',
          draftedAt: new Date().toISOString(),
          draftedPrompt: '仅显示前 5 个柱子',
          intentHint: 'CHART',
          sourceResponseId: 12,
          sourceAidKind: 'TRIGGER_CHART_REFINE',
        },
        question: '仅显示前 5 个柱子',
        responses,
        selectedResponseId: 12,
      }),
    ).toMatchObject({
      sourceResponseId: 12,
      resolvedIntent: {
        kind: 'CHART',
        sourceResponseId: 12,
      },
    });
  });

  it('invalidates draft metadata when the user rewrites the prompt too much', () => {
    expect(
      shouldApplyComposerDraftIntent({
        draftIntent: {
          draftKey: 'draft-3',
          draftedAt: new Date().toISOString(),
          draftedPrompt: '推荐几个问题给我',
          intentHint: 'RECOMMEND_QUESTIONS',
          sourceResponseId: 11,
        },
        question: '解释一下为什么会这样',
      }),
    ).toBe(false);
  });
});
