import { create } from 'zustand';
import { isBffEnabled } from '@/bff/env';
import { createSession, getSession, listSessions, postArtifactPublish, postArtifactSave } from '@/bff/client';
import type { SessionSummary } from '@/bff/client';
import { fixtureAskSessions } from './fixtures';
import { nextId, sessionStream } from './stream';
import type { StreamHandlers } from './stream';
import { isArtifactSaved } from './types';
import type { AskSessionData, ArtifactEvent, PublishedEvent, SavedEvent, UserEvent } from './types';
import { t } from '@/i18n/strings';

/** Route id for a brand-new, not-yet-saved conversation (the `/ask` landing view). */
export const DRAFT_SESSION_ID = 'draft';

function emptySession(id: string): AskSessionData {
  // `title` is never read/rendered — the sidebar renders from `sessionList`
  // (live) or fixtures, never from this in-memory placeholder — so it's not
  // wired through i18n.
  return { id, title: 'New session', updatedAt: 'now', events: [], workLog: [] };
}

/** Single-line, ~60-char title for the backend session a draft's first ask lazily creates. */
function titleFromQuestion(text: string, max = 60): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > max ? `${singleLine.slice(0, max - 1)}…` : singleLine;
}

// Module-level (not store state): guards a draft's lazy `createSession()`
// against being kicked off twice — e.g. two `sendMessage` calls landing on
// the same draft before the first `POST /api/sessions` resolves (a second
// message typed just after send, before the route has replaced). The second
// caller awaits the first's in-flight promise instead of issuing a duplicate
// create.
const inFlightCreate: Record<string, Promise<string>> = {};

interface SessionStoreState {
  sessionsById: Record<string, AskSessionData>;
  /** Whether a turn is in flight for a given session id. */
  streaming: Record<string, boolean>;
  /** The last stream error for a session id, if the most recent turn failed. */
  streamError: Record<string, string | undefined>;
  /** Local session id → real backend session id, once created live. Fixture mode never populates this. */
  backendSessionId: Record<string, string>;
  /** Real, persisted sessions from the BFF for the sidebar, most-recent first. Fixture mode leaves this empty — the sidebar renders fixtures instead. */
  sessionList: SessionSummary[];
  /** Returns the session, seeding an empty one first if it doesn't exist yet. */
  getOrCreate: (id: string) => AskSessionData;
  /** Append a user turn and drive the (fixture or live) stream seam to its answer. */
  sendMessage: (id: string, text: string) => void;
  /**
   * Save an artifact to the Artifacts page — the explicit opt-in the user
   * must take before an agent-produced artifact appears there; nothing is
   * auto-listed. Live mode POSTs to the BFF's real save route (keyed by the
   * artifact's real `artifactId`, not this event's local id) and appends the
   * returned `SavedEvent`; fixture mode appends an optimistic local one.
   */
  saveArtifact: (id: string, artifactEventId: string) => void;
  /**
   * Turn a saved artifact into a published, shareable one. Live mode POSTs
   * to the BFF's real publish route (keyed by the artifact's real
   * `artifactId`, not this event's local id) and appends the returned
   * `{link, scope}`; fixture mode keeps the prior optimistic local publish
   * (a fake share link) unchanged.
   */
  publishArtifact: (id: string, artifactEventId: string) => void;
  /** Live-only: refresh the sidebar's session list from the BFF. No-op in fixture mode; keeps the previous list on failure. */
  loadSessions: () => void;
  /** Create a structured session before entering the Sessions-owned workbench. */
  startStructuredSession: () => Promise<string>;
  /**
   * Resets the draft slot (`sessionsById`/`backendSessionId`/`streaming`/
   * `streamError` under `DRAFT_SESSION_ID`) after it has converted to a real
   * session. Without this, `backendSessionId['draft']` stays set forever, so
   * a later visit to `/ask` would see it already resolved and immediately
   * bounce back to that first real session instead of starting a fresh draft.
   */
  clearDraft: () => void;
}

type StoreGet = () => SessionStoreState;
type StoreSet = (
  partial:
    | Partial<SessionStoreState>
    | ((state: SessionStoreState) => Partial<SessionStoreState>),
) => void;

/**
 * Resolves (lazily creating if necessary) the real backend session id for a
 * local id, live mode only. Only ever used for the draft's first `sendMessage`
 * — resuming a real id maps it to itself directly, either in `getOrCreate`
 * (a fresh visit to `/ask/:id`) or in this draft-resolution's own
 * `onResolved` (the id it just created), so this never re-creates a session
 * for an id that already names one.
 *
 * `onResolved`, when given, computes extra state to merge into the SAME
 * `set()` call that records the new `backendSessionId` — atomically, in one
 * render — rather than a separate one after. This matters: `AskSession`
 * watches `backendSessionId[DRAFT_SESSION_ID]` to decide when to replace the
 * route onto the real id, so the re-keyed thread must already exist under
 * that id by the time `backendSessionId` flips, or a render could observe
 * the new id with no session behind it yet.
 */
function resolveBackendSessionId(
  id: string,
  title: string | undefined,
  get: StoreGet,
  set: StoreSet,
  onResolved?: (backendId: string, state: SessionStoreState) => Partial<SessionStoreState>,
): Promise<string> {
  const cached = get().backendSessionId[id];
  if (cached) return Promise.resolve(cached);
  if (id in inFlightCreate) return inFlightCreate[id];

  const promise = createSession(title)
    .then((created) => {
      set((s) => ({
        backendSessionId: { ...s.backendSessionId, [id]: created.id },
        ...(onResolved ? onResolved(created.id, s) : {}),
      }));
      return created.id;
    })
    .finally(() => {
      delete inFlightCreate[id];
    });
  inFlightCreate[id] = promise;
  return promise;
}

/**
 * Ask-session state: the selected session's events + its live WorkLog, plus
 * the sidebar's session list. One store per feature module (per the app's
 * convention) — shell-only state stays in `useUiStore`. With no
 * `VITE_BFF_URL` set, sessions are seeded from fixtures, `sendMessage` drives
 * the fixture stream, and `sessionList`/`loadSessions` stay empty/no-op —
 * unchanged from before.
 *
 * When the BFF is enabled, `/ask` (`DRAFT_SESSION_ID`) is a local-only draft:
 * `getOrCreate` seeds it empty and does NOT create a backend session or
 * hydrate. `/ask/:id` for a real backend id instead identity-maps
 * `backendSessionId[id] = id` and hydrates via `GET /api/sessions/:id` — it
 * never creates. A draft's backend session is created lazily, on its first
 * `sendMessage`, titled from the question itself; once that resolves,
 * `sendMessage` re-keys the draft's in-memory thread onto the real id (so the
 * in-flight stream keeps updating) and refreshes `sessionList` so the new
 * session appears in the sidebar. `AskSession` watches `backendSessionId`
 * for the draft and replaces the route onto the real id once it's known, so
 * a reload resumes the persisted session instead of a fresh draft.
 */
export const useSessionStore = create<SessionStoreState>()((set, get) => ({
  sessionsById: { ...fixtureAskSessions },
  streaming: {},
  streamError: {},
  backendSessionId: {},
  sessionList: [],

  getOrCreate: (id) => {
    const existing = get().sessionsById[id];
    if (existing) return existing;
    const created = emptySession(id);
    set((s) => ({ sessionsById: { ...s.sessionsById, [id]: created } }));

    // The draft is never persisted until its first `sendMessage` (lazy
    // create, below) — there is nothing on the backend to hydrate yet.
    if (id === DRAFT_SESSION_ID || !isBffEnabled()) return created;

    // Resuming a real backend session id (from the sidebar, or a reload
    // landing on `/ask/:id`): identity-map it — never `createSession` for an
    // id that already names a persisted session — and hydrate its events.
    set((s) => ({ backendSessionId: { ...s.backendSessionId, [id]: id } }));
    getSession(id)
      .then((hydrated) => {
        set((s) => {
          const current = s.sessionsById[id];
          if (!current) return s;
          // Don't clobber local state the user has already advanced past:
          // this hydrate GET can resolve AFTER sendMessage has optimistically
          // appended a turn (or a stream is in flight), and a wholesale
          // replace would wipe the just-typed question / in-progress answer.
          if (current.events.length > 0 || s.streaming[id]) return s;
          return { sessionsById: { ...s.sessionsById, [id]: hydrated } };
        });
      })
      .catch(() => {
        // Best-effort hydrate — keep the local placeholder on failure.
      });

    return created;
  },

  sendMessage: (id, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    get().getOrCreate(id);

    const userEvent: UserEvent = { id: nextId('e'), kind: 'user', text: trimmed };
    set((s) => {
      const session = s.sessionsById[id] ?? emptySession(id);
      return {
        sessionsById: {
          ...s.sessionsById,
          [id]: { ...session, events: [...session.events, userEvent], workLog: [] },
        },
        streaming: { ...s.streaming, [id]: true },
        streamError: { ...s.streamError, [id]: undefined },
      };
    });

    // Mutable target for the handlers below: starts as `id`, and flips to
    // the real backend id the moment a draft's lazy `createSession`
    // resolves (see the re-key inside the `isBffEnabled()` branch), so every
    // worklog/event/done update — before AND after that point — lands on
    // whichever id is currently backing the visible thread. No update is
    // ever dropped mid-stream.
    let targetId = id;

    const handlers: StreamHandlers = {
      onWorkLog: (steps) => {
        set((s) => {
          const session = s.sessionsById[targetId];
          if (!session) return s;
          return { sessionsById: { ...s.sessionsById, [targetId]: { ...session, workLog: steps } } };
        });
      },
      onEvent: (event) => {
        set((s) => {
          const session = s.sessionsById[targetId];
          if (!session) return s;
          // An answer is a turn's terminal, inspectable outcome: snapshot the
          // turn's live `workLog` onto it here, before it's appended, so the
          // trace survives the next turn's `workLog: []` reset (see
          // `sendMessage` above) instead of being destroyed by it.
          const withTrace: typeof event =
            event.kind === 'answer' && session.workLog.length > 0
              ? { ...event, trace: session.workLog }
              : event;
          return {
            sessionsById: {
              ...s.sessionsById,
              [targetId]: { ...session, events: [...session.events, withTrace] },
            },
          };
        });
      },
      onError: (message) => {
        set((s) => ({
          streaming: { ...s.streaming, [targetId]: false },
          streamError: { ...s.streamError, [targetId]: message },
        }));
      },
      onDone: () => {
        set((s) => ({ streaming: { ...s.streaming, [targetId]: false } }));
      },
    };

    if (isBffEnabled()) {
      // Only the draft's very first ask (no backend id yet) creates a
      // session; every other call — including a second message typed before
      // the route has replaced — hits the `resolveBackendSessionId` cache
      // and skips straight to `sessionStream`.
      const isFirstDraftAsk = id === DRAFT_SESSION_ID && !get().backendSessionId[id];
      const title = isFirstDraftAsk ? titleFromQuestion(trimmed) : undefined;

      // Re-key the draft's in-memory thread (the just-appended question,
      // streaming flag, any error) onto the real id in the SAME `set()` call
      // that records `backendSessionId` — see `resolveBackendSessionId`'s
      // doc comment for why this must be atomic.
      const onResolved = isFirstDraftAsk
        ? (backendId: string, s: SessionStoreState): Partial<SessionStoreState> => {
            const draftSession = s.sessionsById[id];
            if (!draftSession) return {};
            targetId = backendId;
            return {
              sessionsById: { ...s.sessionsById, [backendId]: { ...draftSession, id: backendId } },
              // Identity-map the real id onto itself too (not just
              // `backendSessionId[DRAFT_SESSION_ID]`, which the outer
              // `set()` in `resolveBackendSessionId` already records):
              // once `AskSession` replaces the route onto `/ask/:backendId`,
              // `getOrCreate(backendId)` finds the thread already re-keyed
              // here and returns early — see its doc comment — so it never
              // performs the "resuming a real id" identity-map itself. Without
              // this, the next `sendMessage(backendId, …)` finds no cached
              // `backendSessionId[backendId]` and calls `createSession()`
              // again instead of reusing this session for the follow-up turn.
              backendSessionId: { ...s.backendSessionId, [id]: backendId, [backendId]: backendId },
              streaming: { ...s.streaming, [backendId]: s.streaming[id] },
              streamError: { ...s.streamError, [backendId]: s.streamError[id] },
            };
          }
        : undefined;

      resolveBackendSessionId(id, title, get, set, onResolved)
        .then((backendId) => {
          if (isFirstDraftAsk) {
            get().loadSessions();
          }
          return sessionStream(trimmed, handlers, backendId);
        })
        .catch((err: unknown) => {
          handlers.onError?.(err instanceof Error ? err.message : t('ask.harnessUnreachable'));
        });
    } else {
      sessionStream(trimmed, handlers);
    }
  },

  loadSessions: () => {
    if (!isBffEnabled()) return;

    listSessions()
      .then((sessionList) => {
        set({ sessionList });
      })
      .catch(() => {
        // Best-effort — keep whatever list is already shown on failure.
      });
  },

  async startStructuredSession() {
    if (!isBffEnabled()) {
      const id = nextId('structured-session');
      const session = emptySession(id);
      set((s) => ({ sessionsById: { ...s.sessionsById, [id]: session } }));
      return id;
    }

    const created = await createSession('New Structured Ask');
    const session = { ...emptySession(created.id), title: created.title, updatedAt: created.updatedAt };
    set((s) => ({
      sessionsById: { ...s.sessionsById, [created.id]: session },
      backendSessionId: { ...s.backendSessionId, [created.id]: created.id },
      sessionList: [
        { id: created.id, title: created.title, updatedAt: created.updatedAt },
        ...s.sessionList.filter((item) => item.id !== created.id),
      ],
    }));
    return created.id;
  },

  clearDraft: () => {
    set((s) => {
      const { [DRAFT_SESSION_ID]: _droppedSession, ...sessionsById } = s.sessionsById;
      const { [DRAFT_SESSION_ID]: _droppedBackendId, ...backendSessionId } = s.backendSessionId;
      const { [DRAFT_SESSION_ID]: _droppedStreaming, ...streaming } = s.streaming;
      const { [DRAFT_SESSION_ID]: _droppedStreamError, ...streamError } = s.streamError;
      return { sessionsById, backendSessionId, streaming, streamError };
    });
  },

  saveArtifact: (id, artifactEventId) => {
    const session = get().sessionsById[id];
    if (!session) return;
    const artifact = session.events.find(
      (e): e is ArtifactEvent => e.kind === 'artifact' && e.id === artifactEventId,
    );
    if (!artifact) return;
    // Keyed on artifactId, not name: two artifacts in the same session can share a
    // name (e.g. re-running the same prompt twice), and a name-keyed guard would
    // treat an unsaved, same-named artifact as already saved — blocking its save.
    // Latest-wins (via `isArtifactSaved`), not "a saved event exists": an artifact
    // unpinned from the Artifacts page has a later 'unsaved' event and must stay
    // save-able, not get stuck permanently "already saved".
    const alreadySaved = isArtifactSaved(session.events, artifact.artifactId);
    if (alreadySaved) return;

    const appendSaved = (saved: SavedEvent) => {
      set((s) => {
        const current = s.sessionsById[id];
        if (!current) return s;
        // Re-check under the latest state — a concurrent save (or the dedup
        // guard above racing an in-flight request) must not double-append.
        const stillUnsaved = !isArtifactSaved(current.events, artifact.artifactId);
        if (!stillUnsaved) return s;
        return {
          sessionsById: { ...s.sessionsById, [id]: { ...current, events: [...current.events, saved] } },
        };
      });
    };

    if (isBffEnabled()) {
      if (!artifact.artifactId) {
        // Shouldn't happen live — the BFF always stamps a real artifactId on
        // the artifact frame — but don't crash the UI if it's ever missing.
        return;
      }
      const backendId = get().backendSessionId[id] ?? id;
      postArtifactSave(backendId, artifact.artifactId)
        .then(({ savedAt }) => {
          appendSaved({ id: nextId('e'), kind: 'saved', artifactId: artifact.artifactId, artifactName: artifact.name, savedAt });
        })
        .catch(() => {
          // Best-effort — leave the artifact unsaved on failure, same as `publishArtifact`.
        });
      return;
    }

    // Offline: optimistic local save only.
    appendSaved({
      id: nextId('e'),
      kind: 'saved',
      artifactId: artifact.artifactId,
      artifactName: artifact.name,
      savedAt: new Date().toISOString(),
    });
  },

  publishArtifact: (id, artifactEventId) => {
    const session = get().sessionsById[id];
    if (!session) return;
    const artifact = session.events.find(
      (e): e is ArtifactEvent => e.kind === 'artifact' && e.id === artifactEventId,
    );
    if (!artifact) return;
    const alreadyPublished = session.events.some(
      (e) => e.kind === 'published' && e.artifactName === artifact.name,
    );
    if (alreadyPublished) return;

    const appendPublished = (published: PublishedEvent) => {
      set((s) => {
        const current = s.sessionsById[id];
        if (!current) return s;
        // Re-check under the latest state — a concurrent publish (or the
        // dedup guard above racing an in-flight request) must not double-append.
        const stillUnpublished = !current.events.some(
          (e) => e.kind === 'published' && e.artifactName === artifact.name,
        );
        if (!stillUnpublished) return s;
        return {
          sessionsById: { ...s.sessionsById, [id]: { ...current, events: [...current.events, published] } },
        };
      });
    };

    if (isBffEnabled()) {
      if (!artifact.artifactId) {
        // Shouldn't happen live — the BFF always stamps a real artifactId on
        // the artifact frame — but don't crash the UI if it's ever missing.
        return;
      }
      const backendId = get().backendSessionId[id] ?? id;
      postArtifactPublish(backendId, artifact.artifactId)
        .then(({ link, scope }) => {
          appendPublished({ id: nextId('e'), kind: 'published', artifactName: artifact.name, link, scope });
        })
        .catch(() => {
          // Best-effort — leave the artifact unpublished on failure, same as `useArtifactsStore.publish`.
        });
      return;
    }

    // Offline: optimistic local publish only — unchanged from before.
    appendPublished({
      id: nextId('e'),
      kind: 'published',
      artifactName: artifact.name,
      link: `https://share.genbi.example/${artifactEventId}`,
      scope: 'workspace',
    });
  },
}));
