import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Force the dispatcher down the live branch regardless of `VITE_BFF_URL`.
vi.mock('@/bff/env', () => ({
  isBffEnabled: () => true,
}));

const postTurn = vi.fn();
const turnStreamUrl = vi.fn((sessionId: string, turnId: string) => `http://bff.test/api/sessions/${sessionId}/stream?turn=${turnId}`);

vi.mock('@/bff/client', () => ({
  postTurn: (...args: unknown[]) => postTurn(...args),
  turnStreamUrl: (...args: [string, string]) => turnStreamUrl(...args),
}));

import { sessionStream } from '../stream';
import type { StreamHandlers } from '../stream';

/** A minimal fake `EventSource`: named listeners + a manual `emit` for tests. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  private listeners = new Map<string, ((evt: unknown) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (evt: unknown) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, evt: unknown) {
    for (const cb of this.listeners.get(type) ?? []) cb(evt);
  }
}

function handlers() {
  const h = {
    onWorkLog: vi.fn(),
    onEvent: vi.fn(),
    onError: vi.fn(),
    onDone: vi.fn(),
  };
  return h as typeof h & StreamHandlers;
}

describe('live sessionStream', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    postTurn.mockReset();
    turnStreamUrl.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing live-side (falls back to fixtures) when no sessionId is given', () => {
    const h = handlers();
    // Immediately unsubscribe to clear the fixture path's `setTimeout`s — this
    // test only cares that the live branch (postTurn) was never touched.
    const unsubscribe = sessionStream('anything', h);
    unsubscribe();

    expect(postTurn).not.toHaveBeenCalled();
  });

  it('synthesizes a clarify event and skips the stream when postTurn resolves with clarify', async () => {
    postTurn.mockResolvedValueOnce({ turnId: 't1', clarify: { prompt: 'Which range?', chips: ['This month', 'This quarter'] } });
    const h = handlers();

    sessionStream('how much revenue', h, 's1');
    await vi.waitFor(() => expect(h.onEvent).toHaveBeenCalled());

    expect(postTurn).toHaveBeenCalledWith('s1', 'how much revenue');
    expect(h.onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'clarify', prompt: 'Which range?', chips: ['This month', 'This quarter'] }),
    );
    expect(h.onDone).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('opens an EventSource on the turn stream URL and maps worklog/event/done frames', async () => {
    postTurn.mockResolvedValueOnce({ turnId: 't1' });
    const h = handlers();

    sessionStream('how much revenue', h, 's1');
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    const source = FakeEventSource.instances[0];
    expect(source.url).toBe('http://bff.test/api/sessions/s1/stream?turn=t1');

    const steps = [{ id: 'step-1', label: 'Parse question', state: 'running', kind: 'tool' }];
    source.emit('worklog', { data: JSON.stringify(steps) });
    expect(h.onWorkLog).toHaveBeenCalledWith(steps);

    const event = { id: 'e-1', kind: 'answer', answer: { form: 'text', verified: true, dataAnswer: false, text: 'ok' } };
    source.emit('event', { data: JSON.stringify(event) });
    expect(h.onEvent).toHaveBeenCalledWith(event);

    source.emit('done', {});
    expect(h.onDone).toHaveBeenCalledTimes(1);
    expect(source.closed).toBe(true);
  });

  it('maps a named `error` SSE frame (has data) to onError with the server message', async () => {
    postTurn.mockResolvedValueOnce({ turnId: 't1' });
    const h = handlers();

    sessionStream('how much revenue', h, 's1');
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    source.emit('error', { data: JSON.stringify({ message: 'harness crashed' }) });

    expect(h.onError).toHaveBeenCalledWith('harness crashed');
    expect(source.closed).toBe(true);
  });

  it('maps a connection-level error (no data) to a generic onError message', async () => {
    postTurn.mockResolvedValueOnce({ turnId: 't1' });
    const h = handlers();

    sessionStream('how much revenue', h, 's1');
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    source.emit('error', {});

    expect(h.onError).toHaveBeenCalledWith('Lost connection to the harness stream.');
    expect(source.closed).toBe(true);
  });

  it('reports a rejected postTurn via onError', async () => {
    postTurn.mockRejectedValueOnce(new Error('network down'));
    const h = handlers();

    sessionStream('how much revenue', h, 's1');
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalled());

    expect(h.onError).toHaveBeenCalledWith('network down');
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('closes the EventSource when unsubscribe is called after it opened', async () => {
    postTurn.mockResolvedValueOnce({ turnId: 't1' });
    const h = handlers();

    const unsubscribe = sessionStream('how much revenue', h, 's1');
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    unsubscribe();

    expect(source.closed).toBe(true);
  });

  it('unsubscribing before postTurn resolves prevents the EventSource from ever opening', async () => {
    let resolvePostTurn!: (value: { turnId: string }) => void;
    postTurn.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePostTurn = resolve;
      }),
    );
    const h = handlers();

    const unsubscribe = sessionStream('how much revenue', h, 's1');
    unsubscribe();
    resolvePostTurn({ turnId: 't1' });
    await Promise.resolve();
    await Promise.resolve();

    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
