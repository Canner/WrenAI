import type { WorkbenchArtifactKind } from '@/types/homeIntent';

const THREAD_WORKBENCH_NAVIGATION_HINT_PREFIX =
  'wren.threadWorkbenchNavigationHint';

export type ThreadWorkbenchNavigationHint = {
  preferredArtifact?: WorkbenchArtifactKind | null;
  threadId: number;
};

const getThreadWorkbenchNavigationHintStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch (_error) {
    return null;
  }
};

const buildThreadWorkbenchNavigationHintKey = (threadId: number) =>
  `${THREAD_WORKBENCH_NAVIGATION_HINT_PREFIX}:${threadId}`;

export const primeThreadWorkbenchNavigationHint = (
  hint: ThreadWorkbenchNavigationHint,
) => {
  const storage = getThreadWorkbenchNavigationHintStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      buildThreadWorkbenchNavigationHintKey(hint.threadId),
      JSON.stringify(hint),
    );
  } catch (_error) {
    // ignore storage write failures in restricted browsers
  }
};

export const consumeThreadWorkbenchNavigationHint = (
  threadId?: number | null,
): ThreadWorkbenchNavigationHint | null => {
  if (typeof threadId !== 'number') {
    return null;
  }

  const storage = getThreadWorkbenchNavigationHintStorage();
  if (!storage) {
    return null;
  }

  const key = buildThreadWorkbenchNavigationHintKey(threadId);

  try {
    const raw = storage.getItem(key);
    storage.removeItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as ThreadWorkbenchNavigationHint | null;
    if (!parsed || parsed.threadId !== threadId) {
      return null;
    }

    return {
      threadId: parsed.threadId,
      preferredArtifact: parsed.preferredArtifact || null,
    };
  } catch (_error) {
    storage.removeItem(key);
    return null;
  }
};
