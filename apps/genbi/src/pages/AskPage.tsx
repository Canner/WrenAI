import { useParams } from 'react-router-dom';
import { AskSession } from '@/session/AskSession';
import { DRAFT_SESSION_ID } from '@/session/useSessionStore';

/**
 * Ask page: the conversational session view. `/ask` (no param) always lands
 * on a fresh, local-only draft — an empty composer, not the most recent
 * session — so "New session" (and the default landing route) starts a clean
 * conversation; `/ask/:sessionId` opens a specific (resumed, or in-progress
 * draft-turned-real) session. All thread state lives in `useSessionStore`,
 * driven by the fixture stream seam in `@/session/stream` in fixture mode, or
 * the live BFF in live mode — see `apps/genbi/src/session` for the event
 * model.
 */
export function AskPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const activeId = sessionId ?? DRAFT_SESSION_ID;

  return <AskSession sessionId={activeId} />;
}
