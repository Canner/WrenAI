import { EventEmitter } from 'events';
import { ThreadResponseAnswerStatus } from '@/apollo/server/services/askingService';

const mockResolveRequestScope = jest.fn();
const mockAssertResponseScope = jest.fn();
const mockGetResponseScoped = jest.fn();
const mockChangeThreadResponseAnswerDetailStatusScoped = jest.fn();
const mockStreamTextBasedAnswer = jest.fn();
const mockSendEvent = jest.fn();

jest.mock('@/common', () => ({
  components: {
    runtimeScopeResolver: { resolveRequestScope: mockResolveRequestScope },
    askingService: {
      assertResponseScope: mockAssertResponseScope,
      getResponseScoped: mockGetResponseScoped,
      changeThreadResponseAnswerDetailStatusScoped:
        mockChangeThreadResponseAnswerDetailStatusScoped,
    },
    wrenAIAdaptor: { streamTextBasedAnswer: mockStreamTextBasedAnswer },
    telemetry: { sendEvent: mockSendEvent },
  },
}));

describe('pages/api/ask_task/streaming_answer', () => {
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

  it('returns 400 when responseId is missing', async () => {
    const handler = (await import('../ask_task/streaming_answer')).default;
    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'responseId is required' });
    expect(mockResolveRequestScope).not.toHaveBeenCalled();
  });

  it('uses scoped response APIs before streaming answer output', async () => {
    const handler = (await import('../ask_task/streaming_answer')).default;
    const req = createReq({ responseId: '202' });
    const res = createRes();
    const stream = new EventEmitter() as EventEmitter & { destroy: jest.Mock };
    stream.destroy = jest.fn();

    const runtimeIdentity = {
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    };

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 42 },
      workspace: { id: 'workspace-1' },
      knowledgeBase: { id: 'kb-1' },
      kbSnapshot: { id: 'snapshot-1' },
      deployHash: 'deploy-1',
      userId: 'user-1',
    });
    mockGetResponseScoped.mockResolvedValue({
      id: 202,
      question: 'What happened?',
      answerDetail: {
        status: ThreadResponseAnswerStatus.STREAMING,
        queryId: 'query-1',
      },
    });
    mockChangeThreadResponseAnswerDetailStatusScoped.mockResolvedValue({});
    mockStreamTextBasedAnswer.mockResolvedValue(stream);

    await handler(req, res);

    expect(mockAssertResponseScope).toHaveBeenCalledWith(202, runtimeIdentity);
    expect(mockGetResponseScoped).toHaveBeenCalledWith(202, runtimeIdentity);

    stream.emit('data', Buffer.from('data: {"message":"hello"}\n\n'));
    stream.emit('end');
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.write).toHaveBeenCalledWith(
      Buffer.from('data: {"message":"hello"}\n\n'),
    );
    expect(res.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ done: true })}\n\n`,
    );
    expect(res.end).toHaveBeenCalled();
    expect(
      mockChangeThreadResponseAnswerDetailStatusScoped,
    ).toHaveBeenCalledWith(
      202,
      runtimeIdentity,
      ThreadResponseAnswerStatus.FINISHED,
      'hello',
    );
  });

  it('returns 500 when scoped response guard fails', async () => {
    const handler = (await import('../ask_task/streaming_answer')).default;
    const req = createReq({ responseId: '202' });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 42 },
      workspace: { id: 'workspace-1' },
      knowledgeBase: { id: 'kb-1' },
      kbSnapshot: { id: 'snapshot-1' },
      deployHash: 'deploy-1',
      userId: 'user-1',
    });
    mockAssertResponseScope.mockRejectedValue(
      new Error('response scope mismatch'),
    );

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.end).toHaveBeenCalled();
    expect(mockGetResponseScoped).not.toHaveBeenCalled();
    expect(mockStreamTextBasedAnswer).not.toHaveBeenCalled();
  });
});
