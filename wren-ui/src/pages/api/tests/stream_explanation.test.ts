import { EventEmitter } from 'events';

const mockResolveRequestScope = jest.fn();
const mockAssertAskingTaskScope = jest.fn();
const mockGetAskStreamingResult = jest.fn();

jest.mock('@/common', () => ({
  components: {
    runtimeScopeResolver: { resolveRequestScope: mockResolveRequestScope },
    askingService: { assertAskingTaskScope: mockAssertAskingTaskScope },
    wrenAIAdaptor: { getAskStreamingResult: mockGetAskStreamingResult },
  },
}));

describe('pages/api/v1/stream_explanation', () => {
  let consoleErrorSpy: jest.SpyInstance;

  const createReq = (query: Record<string, any> = {}) => {
    const handlers = new Map<string, () => void>();

    return {
      method: 'GET',
      query,
      on: jest.fn((event: string, handler: () => void) => {
        handlers.set(event, handler);
      }),
      emitClose: () => handlers.get('close')?.(),
    } as any;
  };

  const createRes = () => {
    const res: any = {
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      statusCode: 200,
      body: undefined,
      chunks: [] as string[],
      status: jest.fn(function (code: number) {
        res.statusCode = code;
        return res;
      }),
      json: jest.fn(function (payload: any) {
        res.body = payload;
        return res;
      }),
      write: jest.fn((chunk: string) => {
        res.chunks.push(chunk);
      }),
      end: jest.fn(),
    };
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns 400 when queryId is missing', async () => {
    const handler = (await import('../v1/stream_explanation')).default;
    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'queryId is required' });
    expect(mockResolveRequestScope).not.toHaveBeenCalled();
  });

  it('validates runtime scope before streaming explanation output', async () => {
    const handler = (await import('../v1/stream_explanation')).default;
    const req = createReq({ queryId: 'query-1' });
    const res = createRes();
    const stream = new EventEmitter() as EventEmitter & {
      destroy: jest.Mock;
    };
    stream.destroy = jest.fn();

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 42 },
      workspace: { id: 'workspace-1' },
      knowledgeBase: { id: 'kb-1' },
      kbSnapshot: { id: 'snapshot-1' },
      deployHash: 'deploy-1',
      userId: 'user-1',
    });
    mockGetAskStreamingResult.mockResolvedValue(stream);

    await handler(req, res);

    expect(mockAssertAskingTaskScope).toHaveBeenCalledWith('query-1', {
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/event-stream',
    );

    stream.emit('data', Buffer.from('data: {"message":"hello"}\n\n'));
    stream.emit('end');
    req.emitClose();

    expect(res.write).toHaveBeenCalledWith(
      Buffer.from('data: {"message":"hello"}\n\n'),
    );
    expect(res.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ done: true })}\n\n`,
    );
    expect(res.end).toHaveBeenCalled();
    expect(stream.destroy).toHaveBeenCalled();
  });

  it('returns 500 when the runtime-scope guard fails', async () => {
    const handler = (await import('../v1/stream_explanation')).default;
    const req = createReq({ queryId: 'query-1' });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 42 },
      workspace: { id: 'workspace-1' },
      knowledgeBase: { id: 'kb-1' },
      kbSnapshot: { id: 'snapshot-1' },
      deployHash: 'deploy-1',
      userId: 'user-1',
    });
    mockAssertAskingTaskScope.mockRejectedValue(
      new Error('task scope mismatch'),
    );

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'task scope mismatch' });
    expect(res.flushHeaders).not.toHaveBeenCalled();
    expect(mockGetAskStreamingResult).not.toHaveBeenCalled();
  });
});
