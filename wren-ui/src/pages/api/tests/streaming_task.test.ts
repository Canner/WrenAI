import { EventEmitter } from 'events';

const mockResolveRequestScope = jest.fn();
const mockAssertAskingTaskScope = jest.fn();
const mockGetAskStreamingResult = jest.fn();

jest.mock('@/common', () => ({
  components: {
    runtimeScopeResolver: { resolveRequestScope: mockResolveRequestScope },
    askingService: {
      assertAskingTaskScope: mockAssertAskingTaskScope,
    },
    wrenAIAdaptor: { getAskStreamingResult: mockGetAskStreamingResult },
  },
}));

describe.each([
  ['legacy', '../ask_task/streaming'],
  ['v1', '../v1/asking-tasks/[id]/stream'],
])('%s asking task stream API', (_label, modulePath) => {
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
      writableEnded: false,
      headersSent: false,
      statusCode: 200,
      body: undefined,
      chunks: [] as Array<string | Buffer>,
      status: jest.fn(function (code: number) {
        res.statusCode = code;
        return res;
      }),
      json: jest.fn(function (payload: any) {
        res.body = payload;
        return res;
      }),
      write: jest.fn((chunk: string | Buffer) => {
        res.headersSent = true;
        res.chunks.push(chunk);
      }),
      end: jest.fn(() => {
        res.writableEnded = true;
      }),
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

  it('returns 400 when task id is missing', async () => {
    const handler = (await import(modulePath)).default;
    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'queryId is required' });
  });

  it('streams asking task output after scope validation', async () => {
    const handler = (await import(modulePath)).default;
    const req = createReq(
      modulePath.includes('[id]') ? { id: 'ask-1' } : { queryId: 'ask-1' },
    );
    const res = createRes();
    const stream = new EventEmitter() as EventEmitter & { destroy: jest.Mock };
    stream.destroy = jest.fn();

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 42 },
      workspace: { id: 'workspace-1' },
      knowledgeBase: { id: 'kb-1' },
      kbSnapshot: { id: 'snapshot-1' },
      deployHash: 'deploy-1',
      userId: 'user-1',
    });
    mockAssertAskingTaskScope.mockResolvedValue(undefined);
    mockGetAskStreamingResult.mockResolvedValue(stream);

    const request = handler(req, res);
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    stream.emit('data', Buffer.from('data: {"message":"planning"}\n\n'));
    stream.emit('end');
    await request;

    expect(mockAssertAskingTaskScope).toHaveBeenCalled();
    expect(mockGetAskStreamingResult).toHaveBeenCalledWith('ask-1');
    expect(res.write).toHaveBeenCalledWith(
      Buffer.from('data: {"message":"planning"}\n\n'),
    );
    expect(res.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ done: true })}\n\n`,
    );
    expect(res.end).toHaveBeenCalled();
  });
});
