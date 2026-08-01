import { PUBLISH_UI_ENABLED } from '@/app/features';
import { EnvelopeView } from '@/envelope';
import { t } from '@/i18n/strings';
import { AgentMessage } from './messages/AgentMessage';
import { ArtifactCard } from './messages/ArtifactCard';
import { ClarifyChips } from './messages/ClarifyChips';
import { PublishedCard } from './messages/PublishedCard';
import { RefusalCard } from './messages/RefusalCard';
import { TextAnswer } from './messages/TextAnswer';
import { UserMessage } from './messages/UserMessage';
import { WorkLog } from './WorkLog';
import { isArtifactSaved, type SessionEvent } from './types';

interface Props {
  events: SessionEvent[];
  onChipSelect: (chip: string) => void;
  onSave: (artifactEventId: string) => void;
  onPublish: (artifactEventId: string) => void;
}

/** Renders a session's events in order, dispatching each to its renderer. */
export function EventList({ events, onChipSelect, onSave, onPublish }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {events.map((event, i) => {
        switch (event.kind) {
          case 'user':
            return <UserMessage key={event.id} event={event} />;

          case 'clarify': {
            // Chips are only actionable on the latest turn; once the thread
            // has moved on, they're read-only history.
            const isLatest = i === events.length - 1;
            return (
              <AgentMessage key={event.id}>
                <ClarifyChips event={event} onSelect={onChipSelect} disabled={!isLatest} />
              </AgentMessage>
            );
          }

          case 'answer':
            return (
              <AgentMessage key={event.id}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* This turn's tool trace, persisted onto the event itself
                      (see `useSessionStore.onEvent`) so it survives follow-up
                      turns — collapsed by default; expand to inspect. */}
                  {event.trace && event.trace.length > 0 && (
                    <WorkLog steps={event.trace} title={t('ask.executionTrace')} />
                  )}
                  {event.answer.form === 'rich' ? (
                    <EnvelopeView envelope={event.answer.envelope} />
                  ) : (
                    <TextAnswer answer={event.answer} />
                  )}
                </div>
              </AgentMessage>
            );

          case 'refusal':
            return (
              <AgentMessage key={event.id}>
                <RefusalCard event={event} />
              </AgentMessage>
            );

          case 'artifact': {
            // Keyed on artifactId, not name: two artifacts in the same session can
            // share a name (e.g. re-running the same prompt twice), and matching by
            // name would render an unsaved sibling as already "Saved" too, with no
            // way left to save it. Latest-wins: a 'saved' event can be followed by
            // an 'unsaved' one (unpinned from the Artifacts page), so the state is
            // whichever of the two is most recent, not just "a saved event exists".
            const saved = isArtifactSaved(events, event.artifactId);
            const published = events.some(
              (e) => e.kind === 'published' && e.artifactName === event.name,
            );
            return (
              <AgentMessage key={event.id}>
                <ArtifactCard
                  event={event}
                  saved={saved}
                  onSave={() => onSave(event.id)}
                  published={published}
                  onPublish={() => onPublish(event.id)}
                />
              </AgentMessage>
            );
          }

          case 'published':
            // Gated here rather than inside `PublishedCard` so that hiding it
            // drops the whole thread entry — returning null from the card would
            // leave an empty `AgentMessage` bubble behind.
            if (!PUBLISH_UI_ENABLED) return null;
            return (
              <AgentMessage key={event.id}>
                <PublishedCard event={event} />
              </AgentMessage>
            );

          case 'saved':
          case 'unsaved':
            // Bookkeeping-only, like 'published' — the "Saved" state is
            // recomputed on the 'artifact' event above; these events
            // themselves never render a card.
            return null;

          default:
            return null;
        }
      })}
    </div>
  );
}
