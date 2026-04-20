export {};

const mockGenerateModelRecommendationQuestions = jest.fn();
const mockGetModelRecommendationQuestions = jest.fn();
const mockBuildApiContextFromRequest = jest.fn();
const mockSendRestApiError = jest.fn(
  (res: any, error: Error & { statusCode?: number }) => {
    res.statusCode = error.statusCode || 500;
    res.body = { error: error.message };
    return res;
  },
);

class MockApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

jest.mock('@server/controllers/modelController', () => ({
  ModelController: jest.fn().mockImplementation(() => ({
    generateModelRecommendationQuestions:
      mockGenerateModelRecommendationQuestions,
    getModelRecommendationQuestions: mockGetModelRecommendationQuestions,
  })),
}));

jest.mock('@/server/api/apiContext', () => ({
  buildApiContextFromRequest: mockBuildApiContextFromRequest,
}));

jest.mock('@/server/api/restApi', () => ({
  sendRestApiError: mockSendRestApiError,
}));

jest.mock('@/server/utils/apiUtils', () => ({
  ApiError: MockApiError,
}));

describe('pages/api/v1/models/[id]/recommendation-questions route', () => {
  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'GET',
      query: { id: '7' },
      body: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => {
    const res = { statusCode: 200, body: null } as any;
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (payload: any) => {
      res.body = payload;
      return res;
    };
    res.setHeader = jest.fn();
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildApiContextFromRequest.mockResolvedValue({ runtimeScope: {} });
  });

  it('returns model recommendation questions on GET', async () => {
    const handler = (await import('../v1/models/[id]/recommendation-questions'))
      .default;
    const req = createReq();
    const res = createRes();

    mockGetModelRecommendationQuestions.mockResolvedValue({
      error: null,
      queryId: 'rq-1',
      questions: [],
      status: 'GENERATING',
      updatedAt: null,
    });

    await handler(req, res);

    expect(mockGetModelRecommendationQuestions).toHaveBeenCalledWith({
      modelId: 7,
      ctx: { runtimeScope: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      error: null,
      queryId: 'rq-1',
      questions: [],
      status: 'GENERATING',
      updatedAt: null,
    });
  });

  it('starts model recommendation generation on POST', async () => {
    const handler = (await import('../v1/models/[id]/recommendation-questions'))
      .default;
    const req = createReq({ method: 'POST' });
    const res = createRes();

    mockGenerateModelRecommendationQuestions.mockResolvedValue({
      error: null,
      queryId: 'rq-1',
      questions: [],
      status: 'GENERATING',
      updatedAt: null,
    });

    await handler(req, res);

    expect(mockGenerateModelRecommendationQuestions).toHaveBeenCalledWith({
      modelId: 7,
      ctx: { runtimeScope: {} },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 when the model id is invalid', async () => {
    const handler = (await import('../v1/models/[id]/recommendation-questions'))
      .default;
    const req = createReq({ query: { id: '0' } });
    const res = createRes();

    await handler(req, res);

    expect(mockGenerateModelRecommendationQuestions).not.toHaveBeenCalled();
    expect(mockGetModelRecommendationQuestions).not.toHaveBeenCalled();
    expect(mockSendRestApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Model ID is invalid' });
  });
});
