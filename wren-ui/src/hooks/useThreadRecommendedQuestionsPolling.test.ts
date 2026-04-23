import {
  buildThreadRecommendationQuestionsUrl,
  loadThreadRecommendationQuestionsPayload,
  normalizeThreadRecommendationQuestionsPayload,
} from './useThreadRecommendedQuestionsPolling';

describe('useThreadRecommendedQuestionsPolling helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds the REST thread recommendation questions url with runtime scope query params', () => {
    expect(
      buildThreadRecommendationQuestionsUrl({
        threadId: 42,
        runtimeScopeSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      }),
    ).toBe(
      '/api/v1/thread-recommendation-questions/42?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );
  });

  it('normalizes invalid payloads to null', () => {
    expect(normalizeThreadRecommendationQuestionsPayload(null)).toBeNull();
    expect(
      normalizeThreadRecommendationQuestionsPayload({ questions: [] }),
    ).toBeNull();
    expect(
      normalizeThreadRecommendationQuestionsPayload({
        status: 'FINISHED',
        questions: 'invalid',
      }),
    ).toBeNull();
  });

  it('loads and normalizes the REST recommended questions payload', async () => {
    const responsePayload = {
      status: 'FINISHED',
      questions: [
        {
          question: '按地区拆分趋势',
          category: '分析',
          sql: 'select 1',
        },
      ],
      error: null,
      resolvedIntent: {
        kind: 'RECOMMEND_QUESTIONS',
        mode: 'FOLLOW_UP',
        target: 'THREAD_SIDECAR',
        source: 'derived',
        sourceThreadId: 42,
        sourceResponseId: 9,
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
      },
    };
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => responsePayload,
    });

    await expect(
      loadThreadRecommendationQuestionsPayload({
        threadId: 42,
        runtimeScopeSelector: {
          workspaceId: 'ws-1',
        },
        fetcher,
      }),
    ).resolves.toEqual(responsePayload);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/thread-recommendation-questions/42?workspaceId=ws-1',
      { cache: 'no-store' },
    );
  });
});
