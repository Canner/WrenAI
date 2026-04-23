import type { ThreadResponse } from '@/types/home';
import type { WorkbenchArtifactKind } from '@/types/homeIntent';
import {
  isRenderableWorkbenchArtifact,
  resolveFallbackWorkbenchArtifact,
} from './threadWorkbenchState';

const THREAD_WORKBENCH_REPLAY_STATE_PREFIX = 'wren.threadWorkbenchReplayState';

export type PersistedThreadWorkbenchState = {
  activeArtifact?: WorkbenchArtifactKind | null;
  isOpen: boolean;
  selectedResponseId: number | null;
  threadId: number;
};

export type RestoredThreadWorkbenchState = {
  activeArtifact: WorkbenchArtifactKind | null;
  isOpen: boolean;
  selectedResponseId: number;
};

const getThreadWorkbenchReplayStateStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch (_error) {
    return null;
  }
};

const buildThreadWorkbenchReplayStateKey = (threadId: number) =>
  `${THREAD_WORKBENCH_REPLAY_STATE_PREFIX}:${threadId}`;

export const readPersistedThreadWorkbenchState = (
  threadId?: number | null,
): PersistedThreadWorkbenchState | null => {
  if (typeof threadId !== 'number') {
    return null;
  }

  const storage = getThreadWorkbenchReplayStateStorage();
  if (!storage) {
    return null;
  }

  const key = buildThreadWorkbenchReplayStateKey(threadId);
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as PersistedThreadWorkbenchState | null;
    if (
      !parsed ||
      parsed.threadId !== threadId ||
      typeof parsed.isOpen !== 'boolean'
    ) {
      storage.removeItem(key);
      return null;
    }

    return {
      threadId: parsed.threadId,
      selectedResponseId:
        typeof parsed.selectedResponseId === 'number'
          ? parsed.selectedResponseId
          : null,
      activeArtifact: parsed.activeArtifact || null,
      isOpen: parsed.isOpen,
    };
  } catch (_error) {
    storage.removeItem(key);
    return null;
  }
};

export const persistThreadWorkbenchState = (
  state: PersistedThreadWorkbenchState,
) => {
  const storage = getThreadWorkbenchReplayStateStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      buildThreadWorkbenchReplayStateKey(state.threadId),
      JSON.stringify(state),
    );
  } catch (_error) {
    // ignore storage write failures in restricted browsers
  }
};

export const clearPersistedThreadWorkbenchState = (
  threadId?: number | null,
) => {
  if (typeof threadId !== 'number') {
    return;
  }

  const storage = getThreadWorkbenchReplayStateStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(buildThreadWorkbenchReplayStateKey(threadId));
  } catch (_error) {
    // ignore storage cleanup failures
  }
};

export const resolveRestoredThreadWorkbenchState = ({
  persistedState,
  responses,
}: {
  persistedState?: PersistedThreadWorkbenchState | null;
  responses: ThreadResponse[];
}): RestoredThreadWorkbenchState | null => {
  if (
    !persistedState ||
    typeof persistedState.selectedResponseId !== 'number'
  ) {
    return null;
  }

  const selectedResponse =
    responses.find(
      (response) => response.id === persistedState.selectedResponseId,
    ) || null;

  if (!selectedResponse) {
    return null;
  }

  const activeArtifact =
    persistedState.activeArtifact &&
    isRenderableWorkbenchArtifact(
      selectedResponse,
      persistedState.activeArtifact,
    )
      ? persistedState.activeArtifact
      : resolveFallbackWorkbenchArtifact(selectedResponse);

  return {
    selectedResponseId: selectedResponse.id,
    activeArtifact,
    isOpen: Boolean(persistedState.isOpen && activeArtifact),
  };
};
