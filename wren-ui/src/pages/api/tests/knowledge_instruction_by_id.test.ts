const mockResolveRequestScope = jest.fn();
const mockGetInstruction = jest.fn();
const mockUpdateInstruction = jest.fn();
const mockDeleteInstruction = jest.fn();
const mockRespondWithSimple = jest.fn();
const mockHandleApiError = jest.fn(
  async ({ error, res }: { error: Error & { statusCode?: number }; res: any }) => {
    res.statusCode = error.statusCode || 500;
    res.body = { error: error.message };
  },
);

class MockApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

jest.mock('@/common', () => ({
  components: {
    runtimeScopeResolver: { resolveRequestScope: mockResolveRequestScope },
    instructionService: {
      getInstruction: mockGetInstruction,
      updateInstruction: mockUpdateInstruction,
      deleteInstruction: mockDeleteInstruction,
    },
  },
}));

jest.mock('@/apollo/server/utils/apiUtils', () => ({
  ApiError: MockApiError,
  respondWithSimple: mockRespondWithSimple,
  handleApiError: mockHandleApiError,
}));

jest.mock('@server/utils', () => ({
  getLogger: () => ({
    level: 'debug',
    error: jest.fn(),
  }),
}));

describe('pages/api/v1/knowledge/instructions/[id]', () => {
  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'PUT',
      query: { id: '7' },
      body: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => ({ statusCode: 200, body: null }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects updates when the instruction id belongs to another runtime-scope project', async () => {
    const handler = (
      await import('../v1/knowledge/instructions/[id]')
    ).default;
    const req = createReq();
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 1 },
    });
    mockGetInstruction.mockResolvedValue({
      id: 7,
      projectId: 2,
      instruction: 'hidden',
      questions: ['q1'],
      isDefault: false,
    });

    await handler(req, res);

    expect(mockGetInstruction).toHaveBeenCalledWith(7);
    expect(mockUpdateInstruction).not.toHaveBeenCalled();
    expect(mockRespondWithSimple).not.toHaveBeenCalled();
    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Instruction not found' });
  });
});

export {};
