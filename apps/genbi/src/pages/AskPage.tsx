import { useParams } from 'react-router-dom';
import { AskSession } from '@/session/AskSession';
import { DRAFT_SESSION_ID } from '@/session/useSessionStore';

/**
 * Structured Ask canvas: the conversational session view. Its Sessions-owned
 * route normally supplies a persisted id; the no-param case remains a draft
 * only for migrated legacy `/ask` links until their first question.
 * All thread state lives in `useSessionStore`,
 * driven by the fixture stream seam in `@/session/stream` in fixture mode, or
 * the live BFF in live mode — see `apps/genbi/src/session` for the event
 * model.
 */
export function AskPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const activeId = sessionId ?? DRAFT_SESSION_ID;

  return <AskSession sessionId={activeId} />;
}
