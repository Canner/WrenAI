import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button } from 'antd';
import { PageContainer, PageState } from '@/ui';
import { t } from '@/i18n/strings';
import { Composer } from './Composer';
import { EventList } from './EventList';
import { WorkLog } from './WorkLog';
import { DRAFT_SESSION_ID, useSessionStore } from './useSessionStore';

interface Props {
  sessionId: string;
}

/**
 * The conversational Ask surface for one session: ordered thread, the
 * current turn's WorkLog, an error affordance if the stream broke, and the
 * composer. All state lives in `useSessionStore`; this component only reads
 * it and dispatches user actions (send / chip select / save / publish).
 */
export function AskSession({ sessionId }: Props) {
  const navigate = useNavigate();
  const session = useSessionStore((s) => s.sessionsById[sessionId]);
  const streaming = useSessionStore((s) => s.streaming[sessionId] ?? false);
  const error = useSessionStore((s) => s.streamError[sessionId]);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const saveArtifact = useSessionStore((s) => s.saveArtifact);
  const publishArtifact = useSessionStore((s) => s.publishArtifact);
  const ensure = useSessionStore((s) => s.getOrCreate);
  const clearDraft = useSessionStore((s) => s.clearDraft);
  // Set once the draft's first ask lazily creates its backend session (live
  // mode only) — see the re-key in `useSessionStore.sendMessage`.
  const draftResolvedTo = useSessionStore((s) =>
    sessionId === DRAFT_SESSION_ID ? s.backendSessionId[DRAFT_SESSION_ID] : undefined,
  );

  // Seed a store entry for a not-yet-seen id (e.g. the draft/new session)
  // so selectors below don't fall through to `undefined`.
  useEffect(() => {
    ensure(sessionId);
  }, [sessionId, ensure]);

  // Once the draft becomes a real, persisted session, move the route onto it
  // (replace, not push) so a reload resumes the same conversation instead of
  // landing back on an empty draft. The store re-keys the in-progress
  // thread/stream onto the real id before this ever fires, so the visible
  // content carries over without a flicker or a dropped update.
  //
  // `clearDraft()` right after: this is a one-shot transition — once the
  // route has replaced onto the real id, the draft's own state (which the
  // real id's copy already carries) must be cleared, most importantly
  // `backendSessionId['draft']`. Left set, a later visit to `/ask` would see
  // it already resolved and bounce straight back to this same session
  // instead of starting a fresh draft. Safe to clear in the same tick as the
  // navigate: the real session's state already lives under `draftResolvedTo`.
  useEffect(() => {
    if (draftResolvedTo) {
      navigate(`/ask/${draftResolvedTo}`, { replace: true });
      clearDraft();
    }
  }, [draftResolvedTo, navigate, clearDraft]);

  const events = session?.events ?? [];
  const workLog = session?.workLog ?? [];

  const lastUserText = useMemo(
    () => [...events].reverse().find((e) => e.kind === 'user')?.text,
    [events],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <PageContainer maxWidth={840}>
          {events.length === 0 ? (
            <PageState
              status="empty"
              title={t('ask.emptyTitle')}
              description={t('ask.emptyDescription')}
            />
          ) : (
            <EventList
              events={events}
              onChipSelect={(chip) => sendMessage(sessionId, chip)}
              onSave={(artifactEventId) => saveArtifact(sessionId, artifactEventId)}
              onPublish={(artifactEventId) => publishArtifact(sessionId, artifactEventId)}
            />
          )}

          {/* The current turn's live trace only — once it completes (`onDone`
              flips `streaming` false), its trace is already carried on the
              terminal AnswerEvent and rendered there instead (see
              `EventList`), so this raw view is hidden to avoid showing it
              twice. */}
          {streaming && workLog.length > 0 && <WorkLog steps={workLog} />}

          {error && (
            <Alert
              type="error"
              showIcon
              message={t('ask.streamErrorTitle')}
              description={error}
              action={
                lastUserText ? (
                  <Button type="link" size="small" onClick={() => sendMessage(sessionId, lastUserText)}>
                    {t('state.retry')}
                  </Button>
                ) : undefined
              }
            />
          )}
        </PageContainer>
      </div>

      <div style={{ maxWidth: 840, margin: '0 auto', width: '100%', padding: '0 26px 16px', boxSizing: 'border-box' }}>
        <Composer onSend={(text) => sendMessage(sessionId, text)} disabled={streaming} />
      </div>
    </div>
  );
}
