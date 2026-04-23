import { EventEmitter } from 'events';
import { TextBasedAnswerStatus } from '@/server/models/adaptor';
import { ThreadResponseAnswerStatus } from '@/server/services/askingService';

const mockResolveRequestScope = jest.fn();
const mockAssertResponseScope = jest.fn();
const mockGetResponseScoped = jest.fn();
const mockGetTextBasedAnswerResult = jest.fn();
const mockStreamTextBasedAnswer = jest.fn();
const mockSendEvent = jest.fn();

jest.mock('@/common', () => ({
  components: {
    runtimeScopeResolver: { resolveRequestScope: mockResolveRequestScope },
    askingService: {
      assertResponseScope: mockAssertResponseScope,
      getResponseScoped: mockGetResponseScoped,
    },
    wrenAIAdaptor: {
      getTextBasedAnswerResult: mockGetTextBasedAnswerResult,
      streamTextBasedAnswer: mockStreamTextBasedAnswer,
    },
    telemetry: { sendEvent: mockSendEvent },
  },
}));

describe.each([
  ['legacy', '../../pages/api/ask_task/streaming_answer'],
  ['v1', '../../pages/api/v1/thread-responses/[id]/stream-answer'],
])('%s thread response stream API', (_label, modulePath) => {
  let consoleErrorSpy: jest.SpyInstance;
  const loadHandler = async () => {
    if (modulePath === '../../pages/api/ask_task/streaming_answer') {
      return (await import('../../pages/api/ask_task/streaming_answer'))
        .default;
    }

    return (
      await import('../../pages/api/v1/thread-responses/[id]/stream-answer')
    ).default;
  };

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
      writableEnded: false,
      headersSent: false,
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
    mockResolveRequestScope.mockReset();
    mockAssertResponseScope.mockReset();
    mockGetResponseScoped.mockReset();
    mockGetTextBasedAnswerResult.mockReset();
    mockStreamTextBasedAnswer.mockReset();
    mockSendEvent.mockReset();
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns 400 when responseId is missing', async () => {
    const handler = await loadHandler();
    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'responseId is required' });
    expect(mockResolveRequestScope).not.toHaveBeenCalled();
  });

  it('uses scoped response APIs before streaming answer output', async () => {
    const handler = await loadHandler();
    const req = createReq(
      modulePath.includes('[id]') ? { id: '202' } : { responseId: '202' },
    );
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
    mockGetTextBasedAnswerResult.mockResolvedValue({
      status: TextBasedAnswerStatus.SUCCEEDED,
    });
    mockStreamTextBasedAnswer.mockResolvedValue(stream);

    const request = handler(req, res);
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockAssertResponseScope).toHaveBeenCalledWith(202, runtimeIdentity);
    expect(mockGetResponseScoped).toHaveBeenCalledWith(202, runtimeIdentity);

    stream.emit('data', Buffer.from('data: {"message":"hello"}\n\n'));
    stream.emit('end');
    await request;

    if (modulePath.includes('ask_task')) {
      expect(res.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Link',
        '</api/v1/thread-responses/[id]/stream-answer>; rel="successor-version"',
      );
    }

    expect(res.write).toHaveBeenCalledWith(
      Buffer.from('data: {"message":"hello"}\n\n'),
    );
    expect(res.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ done: true })}\n\n`,
    );
    expect(res.end).toHaveBeenCalled();
    expect(mockSendEvent).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ question: 'What happened?' }),
    );
  });

  it('returns 500 when scoped response guard fails', async () => {
    const handler = await loadHandler();
    const req = createReq(
      modulePath.includes('[id]') ? { id: '202' } : { responseId: '202' },
    );
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

    expect(res.end).toHaveBeenCalled();
    expect(mockGetResponseScoped).not.toHaveBeenCalled();
    expect(mockStreamTextBasedAnswer).not.toHaveBeenCalled();
  });

  it('replays finished content immediately when the answer has already been finalized', async () => {
    const handler = await loadHandler();
    const req = createReq(
      modulePath.includes('[id]') ? { id: '303' } : { responseId: '303' },
    );
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 42 },
      workspace: { id: 'workspace-1' },
      knowledgeBase: { id: 'kb-1' },
      kbSnapshot: { id: 'snapshot-1' },
      deployHash: 'deploy-1',
      userId: 'user-1',
    });
    mockAssertResponseScope.mockResolvedValue(undefined);
    mockGetResponseScoped.mockResolvedValue({
      id: 303,
      question: 'Already done?',
      answerDetail: {
        status: ThreadResponseAnswerStatus.FINISHED,
        queryId: 'query-finished',
        content: 'final answer',
      },
    });

    await handler(req, res);

    expect(mockStreamTextBasedAnswer).not.toHaveBeenCalled();
    expect(res.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ message: 'final answer' })}\n\n`,
    );
    expect(res.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ done: true })}\n\n`,
    );
    expect(res.end).toHaveBeenCalled();
  });

  it('replays finalized upstream content when the persisted response is still marked streaming', async () => {
    const handler = await loadHandler();
    const req = createReq(
      modulePath.includes('[id]') ? { id: '404' } : { responseId: '404' },
    );
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 42 },
      workspace: { id: 'workspace-1' },
      knowledgeBase: { id: 'kb-1' },
      kbSnapshot: { id: 'snapshot-1' },
      deployHash: 'deploy-1',
      userId: 'user-1',
    });
    mockAssertResponseScope.mockResolvedValue(undefined);
    mockGetResponseScoped.mockResolvedValue({
      id: 404,
      question: 'Late subscriber?',
      answerDetail: {
        status: ThreadResponseAnswerStatus.STREAMING,
        queryId: 'query-finished-upstream',
      },
    });
    mockGetTextBasedAnswerResult.mockResolvedValue({
      status: TextBasedAnswerStatus.SUCCEEDED,
      content: 'upstream final answer',
    });

    await handler(req, res);

    expect(mockStreamTextBasedAnswer).not.toHaveBeenCalled();
    expect(res.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ message: 'upstream final answer' })}\n\n`,
    );
    expect(res.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ done: true })}\n\n`,
    );
    expect(res.end).toHaveBeenCalled();
  });
});
