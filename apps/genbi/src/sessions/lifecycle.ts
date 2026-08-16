import type { NativeSession, NativeSessionVendor } from '@/bff/client';

export interface DeadNativeSessionAction {
  readonly kind: 'resume' | 'restart';
  readonly label: 'Resume conversation' | 'Restart in a new session';
  readonly reason: string;
}

/**
 * Used only when `lifecycle` itself has not arrived yet (e.g. a locally
 * patched row between a status change and the next fetch) — a genuinely
 * unknown state, not one of the server's distinguished causes. Deliberately
 * generic: naming a specific mechanism here would repeat the same defect the
 * server-side reason was fixed for (asserting a cause that isn't known).
 */
const restartOnlyReason: Record<NativeSessionVendor, string> = {
  claude: 'This Claude session cannot be resumed. Restart creates a new isolated session.',
  codex: 'This Codex session cannot be resumed. Restart creates a new isolated session.',
};

const freshRestartReason: Record<NativeSessionVendor, string> = {
  claude: 'Restart starts a separate Claude conversation in a new isolated terminal.',
  codex: 'Restart starts a separate Codex conversation in a new isolated terminal.',
};

function processIsGone(status: NativeSession['status']): boolean {
  return status === 'exited' || status === 'stopped' || status === 'interrupted' || status === 'failed' || status === 'stale';
}

/** A dead Claude row may offer Resume and always retains a distinct Restart fallback. */
export function deadNativeSessionActions(session: Pick<NativeSession, 'status' | 'vendor'> & { lifecycle?: NativeSession['lifecycle'] }): readonly DeadNativeSessionAction[] {
  if (!processIsGone(session.status)) return [];
  const lifecycle = session.lifecycle;
  const restart: DeadNativeSessionAction = { kind: 'restart', label: 'Restart in a new session', reason: lifecycle?.liveAction === 'resume' ? freshRestartReason[session.vendor] : lifecycle?.reason ?? restartOnlyReason[session.vendor] };
  return lifecycle?.liveAction === 'resume' && lifecycle.resumeAvailable
    ? [{ kind: 'resume', label: 'Resume conversation', reason: lifecycle.reason ?? 'Resume continues the retained Claude conversation in a new isolated terminal.' }, restart]
    : [restart];
}

/** Compatibility helper for consumers that need the fallback action only. */
export function deadNativeSessionAction(session: Pick<NativeSession, 'status' | 'vendor'> & { lifecycle?: NativeSession['lifecycle'] }): DeadNativeSessionAction | undefined {
  return deadNativeSessionActions(session).find((action) => action.kind === 'restart');
}
