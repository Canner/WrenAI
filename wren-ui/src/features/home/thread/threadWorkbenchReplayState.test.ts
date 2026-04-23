import type { ThreadResponse } from '@/types/home';
import {
  clearPersistedThreadWorkbenchState,
  persistThreadWorkbenchState,
  readPersistedThreadWorkbenchState,
  resolveRestoredThreadWorkbenchState,
} from './threadWorkbenchReplayState';

const createSessionStorageMock = () => {
  const store = new Map<string, string>();

  return {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
};

const buildAskResponse = (): ThreadResponse =>
  ({
    id: 11,
    question: '各岗位的平均薪资分别是多少？',
    responseKind: 'ANSWER',
    resolvedIntent: {
      kind: 'ASK',
      mode: 'NEW',
      target: 'THREAD_RESPONSE',
      source: 'derived',
      sourceThreadId: 1,
      sourceResponseId: null,
      confidence: null,
      artifactPlan: {
        teaserArtifacts: ['preview_teaser'],
        workbenchArtifacts: ['preview', 'sql'],
        primaryTeaser: 'preview_teaser',
        primaryWorkbenchArtifact: 'preview',
      },
      conversationAidPlan: null,
    },
  }) as ThreadResponse;

describe('threadWorkbenchReplayState', () => {
  const sessionStorage = createSessionStorageMock();

  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage },
    });
    sessionStorage.clear();
  });

  it('persists and reads workbench replay state by thread id', () => {
    persistThreadWorkbenchState({
      threadId: 42,
      selectedResponseId: 11,
      activeArtifact: 'sql',
      isOpen: true,
    });

    expect(readPersistedThreadWorkbenchState(42)).toEqual({
      threadId: 42,
      selectedResponseId: 11,
      activeArtifact: 'sql',
      isOpen: true,
    });

    clearPersistedThreadWorkbenchState(42);
    expect(readPersistedThreadWorkbenchState(42)).toBeNull();
  });

  it('restores selected response and artifact when the persisted state is valid', () => {
    const response = buildAskResponse();

    expect(
      resolveRestoredThreadWorkbenchState({
        persistedState: {
          threadId: 1,
          selectedResponseId: response.id,
          activeArtifact: 'sql',
          isOpen: true,
        },
        responses: [response],
      }),
    ).toEqual({
      selectedResponseId: response.id,
      activeArtifact: 'sql',
      isOpen: true,
    });
  });

  it('falls back to the response primary artifact when the persisted artifact is no longer renderable', () => {
    const response = buildAskResponse();

    expect(
      resolveRestoredThreadWorkbenchState({
        persistedState: {
          threadId: 1,
          selectedResponseId: response.id,
          activeArtifact: 'chart',
          isOpen: true,
        },
        responses: [response],
      }),
    ).toEqual({
      selectedResponseId: response.id,
      activeArtifact: 'preview',
      isOpen: true,
    });
  });

  it('drops the restore when the selected response no longer exists', () => {
    expect(
      resolveRestoredThreadWorkbenchState({
        persistedState: {
          threadId: 1,
          selectedResponseId: 999,
          activeArtifact: 'sql',
          isOpen: true,
        },
        responses: [buildAskResponse()],
      }),
    ).toBeNull();
  });
});
