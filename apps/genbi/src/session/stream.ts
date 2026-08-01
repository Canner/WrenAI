import { fixtureEnvelopes } from '@/fixtures/envelopes';
import { isBffEnabled } from '@/bff/env';
import { postTurn, turnStreamUrl } from '@/bff/client';
import type { SetupStatusEvent } from '@/bff/client';
import { t } from '@/i18n/strings';
import type { AnswerEvent, ArtifactEvent, ClarifyEvent, RefusalEvent, SessionEvent, ToolStep } from './types';

let seq = 0;
/** Monotonic id generator for runtime-created events/steps (fixtures use hand-authored ids). */
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export interface StreamHandlers {
  /** Replaces the current turn's WorkLog (the harness pushes a full snapshot per update). */
  onWorkLog?: (steps: ToolStep[]) => void;
  /** A terminal (or, later, incremental) SessionEvent for this turn. */
  onEvent?: (event: SessionEvent) => void;
  /** The stream broke before a terminal event arrived. */
  onError?: (message: string) => void;
  onDone?: () => void;
}

export type Unsubscribe = () => void;

/**
 * The single seam between the UI and "the harness": a question in, the same
 * `{ onWorkLog, onEvent, onError, onDone }` callbacks out, an `Unsubscribe`
 * back. With no `VITE_BFF_URL` set (the default), this fakes a live SSE/BFF
 * stream with canned, keyword-matched fixture timelines over `setTimeout`
 * (deterministic, not random, so it stays testable). When the BFF is
 * enabled, `sessionId` selects the live implementation instead — same
 * signature, so call sites (`useSessionStore`) do not change.
 *
 * The canned response is chosen by keyword so the demo is deterministic and
 * testable rather than random:
 *  - "error"                → simulates a broken stream (onError, no event)
 *  - salary / ssn / password → a refusal (no fabricated number)
 *  - clarify / which / compare → a clarifying question with chips
 *  - forecast / predict     → a sub-agent delegation trace + an Estimate answer
 *  - dashboard               → a rich answer followed by an artifact offer
 *  - why / explain           → a narrative rich answer
 *  - one or two words        → a short, non-block text answer
 *  - anything else           → the default verified table answer
 */
export function sessionStream(question: string, handlers: StreamHandlers, sessionId?: string): Unsubscribe {
  if (isBffEnabled() && sessionId) {
    return liveSessionStream(sessionId, question, handlers);
  }
  return fixtureSessionStream(question, handlers);
}

/** The subset of `StreamHandlers` that is generic over the `event` frame's payload type. */
interface EventSourceHandlers<E> {
  onWorkLog?: (steps: ToolStep[]) => void;
  onEvent?: (event: E) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

/**
 * Wires the four named SSE frames (`worklog`/`event`/`done`/`error`) a turn
 * stream emits onto a handlers object — shared by the Ask stream
 * (`SessionEvent` frames) and the setup stream (`SetupStatusEvent` frames).
 * Generic over the `event` frame's payload type so each call site keeps its
 * own precise type with no casting at the call site.
 */
function attachTurnStreamListeners<E>(source: EventSource, handlers: EventSourceHandlers<E>): void {
  source.addEventListener('worklog', (evt) => {
    handlers.onWorkLog?.(JSON.parse((evt as MessageEvent).data) as ToolStep[]);
  });
  source.addEventListener('event', (evt) => {
    // Whole-object passthrough — for an Ask `artifact` frame this carries the
    // BFF's `artifactId` (the real persisted row id) straight onto the
    // emitted `ArtifactEvent`, and for a setup turn this carries the terminal
    // `SetupStatusEvent` — either way, no field-by-field mapping needed.
    handlers.onEvent?.(JSON.parse((evt as MessageEvent).data) as E);
  });
  source.addEventListener('done', () => {
    handlers.onDone?.();
    source.close();
  });
  // A single listener for BOTH the BFF's own named `error` frame (a
  // MessageEvent carrying `.data`) and the browser's connection-level
  // failure (a plain Event with no `.data`) — EventSource dispatches both
  // under the type 'error', so disambiguate on `.data` presence rather than
  // also setting `.onerror` (which would double-fire).
  source.addEventListener('error', (evt) => {
    if ('data' in evt) {
      let message = t('ask.streamErrorGeneric');
      try {
        message = (JSON.parse((evt as MessageEvent).data) as { message: string }).message;
      } catch {
        // Malformed error frame — surface a generic message rather than throw in the listener.
      }
      handlers.onError?.(message);
    } else {
      handlers.onError?.(t('ask.streamConnectionLost'));
    }
    source.close();
  });
}

/**
 * Live implementation: `POST /turns` to start the turn, then either
 * synthesize a `ClarifyEvent` locally (when the BFF's own synchronous
 * clarify heuristic already resolved the turn, skipping the stream
 * entirely) or open an `EventSource` on `GET /stream?turn=` and map each
 * named SSE frame 1:1 onto the handlers.
 */
function liveSessionStream(sessionId: string, question: string, handlers: StreamHandlers): Unsubscribe {
  let cancelled = false;
  let source: EventSource | undefined;

  postTurn(sessionId, question)
    .then((result) => {
      if (cancelled) return;

      if (result.clarify) {
        const event: ClarifyEvent = {
          id: nextId('e'),
          kind: 'clarify',
          prompt: result.clarify.prompt,
          chips: result.clarify.chips,
        };
        handlers.onEvent?.(event);
        handlers.onDone?.();
        return;
      }

      source = new EventSource(turnStreamUrl(sessionId, result.turnId));
      attachTurnStreamListeners<SessionEvent>(source, handlers);
    })
    .catch((err: unknown) => {
      if (cancelled) return;
      handlers.onError?.(err instanceof Error ? err.message : t('ask.harnessUnreachable'));
    });

  return () => {
    cancelled = true;
    source?.close();
  };
}

export type SetupStreamHandlers = EventSourceHandlers<SetupStatusEvent>;

/**
 * Opens the same SSE endpoint Ask uses (`GET /stream?turn=`) for a setup
 * turn. Unlike `liveSessionStream`, the caller already created the turn via
 * a REST call (`postSetupConnectTurn` / `postSetupResume`) — this only opens
 * the stream and maps frames onto the handlers, so `onEvent` receives the
 * turn's terminal `SetupStatusEvent` (`ok` | `needs_input`) rather than a
 * `SessionEvent`.
 */
export function setupStream(sessionId: string, turnId: string, handlers: SetupStreamHandlers): Unsubscribe {
  const source = new EventSource(turnStreamUrl(sessionId, turnId));
  attachTurnStreamListeners<SetupStatusEvent>(source, handlers);
  return () => source.close();
}

function fixtureSessionStream(question: string, handlers: StreamHandlers): Unsubscribe {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;
  const after = (ms: number, fn: () => void) => {
    timers.push(
      setTimeout(() => {
        if (!cancelled) fn();
      }, ms),
    );
  };
  const unsubscribe: Unsubscribe = () => {
    cancelled = true;
    timers.forEach(clearTimeout);
  };

  const q = question.toLowerCase();
  const step = (label: string, state: ToolStep['state'], extra: Partial<ToolStep> = {}): ToolStep => ({
    id: nextId('step'),
    label,
    state,
    kind: 'tool',
    ...extra,
  });

  if (/\berror\b/.test(q)) {
    const parsing = step('Understanding question', 'running');
    after(80, () => handlers.onWorkLog?.([parsing]));
    after(260, () => handlers.onWorkLog?.([{ ...parsing, state: 'error' }]));
    after(300, () => handlers.onError?.(t('ask.streamConnectionLost')));
    return unsubscribe;
  }

  if (/salary|ssn|password/.test(q)) {
    const checking = step('Checking access policy', 'running');
    after(80, () => handlers.onWorkLog?.([checking]));
    after(240, () => handlers.onWorkLog?.([{ ...checking, state: 'error' }]));
    after(280, () => {
      const event: RefusalEvent = {
        id: nextId('e'),
        kind: 'refusal',
        reason: 'This question needs a column your role cannot read.',
        fix: 'Ask a workspace admin to grant read access, or ask about an aggregate that does not expose individual values.',
      };
      handlers.onEvent?.(event);
      handlers.onDone?.();
    });
    return unsubscribe;
  }

  if (/clarify|which\b|compare/.test(q)) {
    after(120, () => {
      const event: ClarifyEvent = {
        id: nextId('e'),
        kind: 'clarify',
        prompt: 'Which time range should I use?',
        chips: ['This month', 'This quarter', 'Last 12 months'],
      };
      handlers.onEvent?.(event);
      handlers.onDone?.();
    });
    return unsubscribe;
  }

  if (/forecast|predict/.test(q)) {
    const query = step('Query verified history', 'running', { depth: 0 });
    const delegate = step('Delegate: forecast sub-agent', 'running', { kind: 'subagent', depth: 0 });
    const fit = step('Fit trend model', 'running', { parent: delegate.id, depth: 1 });
    after(80, () => handlers.onWorkLog?.([query]));
    after(220, () => handlers.onWorkLog?.([{ ...query, state: 'done' }, delegate]));
    after(360, () => handlers.onWorkLog?.([{ ...query, state: 'done' }, delegate, fit]));
    after(520, () =>
      handlers.onWorkLog?.([
        { ...query, state: 'done' },
        { ...delegate, state: 'done' },
        { ...fit, state: 'done' },
      ]),
    );
    after(560, () => {
      const event: AnswerEvent = {
        id: nextId('e'),
        kind: 'answer',
        answer: { form: 'rich', envelope: fixtureEnvelopes.forecast },
      };
      handlers.onEvent?.(event);
      handlers.onDone?.();
    });
    return unsubscribe;
  }

  if (/dashboard/.test(q)) {
    const query = step('Query verified history', 'running', { depth: 0 });
    after(80, () => handlers.onWorkLog?.([query]));
    after(260, () => handlers.onWorkLog?.([{ ...query, state: 'done' }]));
    after(300, () => {
      const event: AnswerEvent = {
        id: nextId('e'),
        kind: 'answer',
        answer: { form: 'rich', envelope: fixtureEnvelopes.dashboard },
      };
      handlers.onEvent?.(event);
    });
    after(420, () => {
      const artifact: ArtifactEvent = {
        id: nextId('e'),
        kind: 'artifact',
        name: 'Revenue dashboard',
        artifactKind: 'dashboard',
        location: 'artifacts/revenue-dashboard.json',
        // Placeholder — fixture mode has no real backend artifact row.
        artifactId: nextId('fixture-artifact'),
      };
      handlers.onEvent?.(artifact);
      handlers.onDone?.();
    });
    return unsubscribe;
  }

  if (/why\b|explain/.test(q)) {
    const compare = step('Compare periods', 'running', { depth: 0 });
    after(80, () => handlers.onWorkLog?.([compare]));
    after(240, () => handlers.onWorkLog?.([{ ...compare, state: 'done' }]));
    after(280, () => {
      const event: AnswerEvent = {
        id: nextId('e'),
        kind: 'answer',
        answer: { form: 'rich', envelope: fixtureEnvelopes.explainChange },
      };
      handlers.onEvent?.(event);
      handlers.onDone?.();
    });
    return unsubscribe;
  }

  if (question.trim().split(/\s+/).length <= 2) {
    const parsing = step('Understanding question', 'running', { depth: 0 });
    after(80, () => handlers.onWorkLog?.([parsing]));
    after(220, () => handlers.onWorkLog?.([{ ...parsing, state: 'done' }]));
    after(260, () => {
      const event: AnswerEvent = {
        id: nextId('e'),
        kind: 'answer',
        answer: {
          form: 'text',
          verified: true,
          dataAnswer: false,
          text: `Got it — "${question}" is noted. Ask a fuller question and I will pull verified data.`,
        },
      };
      handlers.onEvent?.(event);
      handlers.onDone?.();
    });
    return unsubscribe;
  }

  // Default: the verified table answer (answer_query).
  const parse = step('Parse question', 'running', { depth: 0 });
  const query = step('Query verified data', 'running', { depth: 0 });
  after(80, () => handlers.onWorkLog?.([parse]));
  after(260, () => handlers.onWorkLog?.([{ ...parse, state: 'done' }, query]));
  after(440, () =>
    handlers.onWorkLog?.([
      { ...parse, state: 'done' },
      { ...query, state: 'done' },
    ]),
  );
  after(480, () => {
    const event: AnswerEvent = {
      id: nextId('e'),
      kind: 'answer',
      answer: { form: 'rich', envelope: fixtureEnvelopes.answerQuery },
    };
    handlers.onEvent?.(event);
    handlers.onDone?.();
  });
  return unsubscribe;
}
