import {
  buildSuggestedQuestionsUrl,
  clearSuggestedQuestionsCache,
  fetchSuggestedQuestions,
} from './homeRest';

describe('homeRest suggested questions helpers', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    clearSuggestedQuestionsCache();
  });

  afterEach(() => {
    clearSuggestedQuestionsCache();
    global.fetch = originalFetch;
  });

  it('builds suggested-questions URLs with runtime scope params', () => {
    expect(
      buildSuggestedQuestionsUrl({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      }),
    ).toBe(
      '/api/v1/suggested-questions?workspaceId=workspace-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );
  });

  it('fetches suggested questions with the selector-aware endpoint', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          questions: [{ question: '最近 30 天 GMV 趋势', label: 'GMV 趋势' }],
        }),
        { status: 200 },
      ),
    );

    const payload = await fetchSuggestedQuestions({
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/suggested-questions?workspaceId=workspace-1&knowledgeBaseId=kb-1',
    );
    expect(payload).toEqual({
      questions: [{ question: '最近 30 天 GMV 趋势', label: 'GMV 趋势' }],
    });
  });

  it('reuses cached suggested questions for the same runtime selector', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          questions: [{ question: '订单异常原因', label: '订单异常' }],
        }),
        { status: 200 },
      ),
    );

    const selector = {
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
    };

    const firstPayload = await fetchSuggestedQuestions(selector);
    const secondPayload = await fetchSuggestedQuestions(selector);

    expect(firstPayload).toEqual(secondPayload);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws the fallback message when the response body is not usable', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => null,
    });

    await expect(
      fetchSuggestedQuestions({ workspaceId: 'workspace-1' }),
    ).rejects.toThrow('加载推荐问题失败，请稍后重试。');
  });
});
