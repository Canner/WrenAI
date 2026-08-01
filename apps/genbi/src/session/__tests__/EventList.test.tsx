import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@/app/theme/ThemeProvider';
import { EventList } from '../EventList';
import { fixtureAskSessions } from '../fixtures';
import type { ArtifactEvent, PublishedEvent, RefusalEvent, SavedEvent, UnsavedEvent } from '../types';

// ECharts needs a real canvas; stub it so chart-bearing rich answers render in jsdom.
vi.mock('echarts', () => ({
  init: () => ({ setOption() {}, resize() {}, dispose() {} }),
}));

function renderEvents(events: Parameters<typeof EventList>[0]['events']) {
  const onChipSelect = vi.fn();
  const onSave = vi.fn();
  const onPublish = vi.fn();
  render(
    <ThemeProvider>
      <EventList events={events} onChipSelect={onChipSelect} onSave={onSave} onPublish={onPublish} />
    </ThemeProvider>,
  );
  return { onChipSelect, onSave, onPublish };
}

describe('EventList', () => {
  it('renders the full event spectrum in order: user, text answer, rich answer, clarify, refusal, artifact, published', () => {
    const { events } = fixtureAskSessions.s1;
    renderEvents(events);

    // user
    expect(screen.getByText('What does MRR mean?')).toBeInTheDocument();
    // text-form answer (verified)
    expect(screen.getByText(/Monthly Recurring Revenue/)).toBeInTheDocument();
    // rich answer (answerQuery table)
    expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0);
    // clarify chips
    expect(screen.getByText('Which time range should the dashboard cover?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Last 12 months' })).toBeInTheDocument();
    // artifact card renders; the published card does not — `PUBLISH_UI_ENABLED`
    // drops the whole thread entry while publishing is unimplemented, so the
    // placeholder share link never reaches the DOM.
    expect(screen.getAllByText('Revenue dashboard').length).toBeGreaterThan(0);
    expect(
      screen.queryByText('https://share.genbi.example/revenue-dashboard'),
    ).not.toBeInTheDocument();
    // refusal — reason + fix guidance, never a fabricated number
    expect(
      screen.getByText('This question needs a column your role cannot read.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ask a workspace admin to grant read access/)).toBeInTheDocument();

    const refusal = events.find((e): e is RefusalEvent => e.kind === 'refusal')!;
    expect(/\d/.test(refusal.reason)).toBe(false);
    expect(/\d/.test(refusal.fix)).toBe(false);

    // Ordering: the DOM order of the two user turns matches event order.
    const bodyText = document.body.textContent ?? '';
    expect(bodyText.indexOf('What does MRR mean?')).toBeLessThan(
      bodyText.indexOf('Top customers by revenue'),
    );
  });

  it('disables clarify chips once a later turn exists (no longer the live prompt)', () => {
    const { onChipSelect } = renderEvents(fixtureAskSessions.s1.events);
    const chip = screen.getByRole('button', { name: 'Last 12 months' });
    expect(chip).toBeDisabled();
    expect(onChipSelect).not.toHaveBeenCalled();
  });

  it('enables the latest clarify prompt and forwards the selected chip', async () => {
    const upToClarify = fixtureAskSessions.s1.events.findIndex((e) => e.id === 's1-e6');
    const clarifyOnly = fixtureAskSessions.s1.events.slice(0, upToClarify + 1);
    const { onChipSelect } = renderEvents(clarifyOnly);
    const chip = screen.getByRole('button', { name: 'Last 12 months' });
    expect(chip).toBeEnabled();
    chip.click();
    expect(onChipSelect).toHaveBeenCalledWith('Last 12 months');
  });

  it('offers no Publish action for an unpublished artifact while publishing is unimplemented', () => {
    const artifact: ArtifactEvent = {
      id: 'art-1',
      kind: 'artifact',
      name: 'Draft report',
      artifactKind: 'report',
      location: 'artifacts/draft-report.json',
      artifactId: 'artifact-art-1',
    };
    const { onPublish } = renderEvents([artifact]);
    // `PUBLISH_UI_ENABLED` is off, so the card keeps its name + location but
    // exposes no way to trigger a publish that can't be opened. When the flag
    // flips, this goes back to asserting the button calls onPublish('art-1').
    expect(screen.getByText('Draft report')).toBeInTheDocument();
    expect(screen.getByText('artifacts/draft-report.json')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
    expect(onPublish).not.toHaveBeenCalled();
  });

  it('offers a Save to Artifacts action for a not-yet-saved artifact, independent of PUBLISH_UI_ENABLED', async () => {
    const user = userEvent.setup();
    const artifact: ArtifactEvent = {
      id: 'art-1',
      kind: 'artifact',
      name: 'Draft report',
      artifactKind: 'report',
      location: 'artifacts/draft-report.json',
      artifactId: 'artifact-art-1',
    };
    const { onSave } = renderEvents([artifact]);

    // AntD's SaveOutlined icon carries its own non-hidden aria-label ("save"),
    // which the accessible-name algorithm prepends to the button's text — so
    // match loosely, same convention as the /publish/i queries below.
    const saveButton = screen.getByRole('button', { name: /save to artifacts/i });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);
    expect(onSave).toHaveBeenCalledWith('art-1');
  });

  it('shows a disabled "Saved" state — not a re-save button — once a matching SavedEvent already exists (proves reload/replay state)', () => {
    const artifact: ArtifactEvent = {
      id: 'art-1',
      kind: 'artifact',
      name: 'Draft report',
      artifactKind: 'report',
      location: 'artifacts/draft-report.json',
      artifactId: 'artifact-art-1',
    };
    const saved: SavedEvent = {
      id: 'saved-1',
      kind: 'saved',
      artifactId: 'artifact-art-1',
      artifactName: 'Draft report',
      savedAt: '2026-07-28T00:00:00.000Z',
    };
    // Simulates a full page reload: both events arrive together via a replayed
    // events list, not one appended after a live click.
    const { onSave } = renderEvents([artifact, saved]);

    const savedButton = screen.getByRole('button', { name: /saved/i });
    expect(savedButton).toBeDisabled();
    expect(screen.queryByRole('button', { name: /save to artifacts/i })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saving one of two same-named artifacts does not mark the other as saved (SavedEvent must key on artifactId, not name)', async () => {
    const user = userEvent.setup();
    // Re-running the same prompt twice produces two distinct artifacts that
    // share a display name but have different artifactIds.
    const first: ArtifactEvent = {
      id: 'art-1',
      kind: 'artifact',
      name: 'Draft report',
      artifactKind: 'report',
      location: 'artifacts/draft-report-1.json',
      artifactId: 'artifact-art-1',
    };
    const second: ArtifactEvent = {
      id: 'art-2',
      kind: 'artifact',
      name: 'Draft report',
      artifactKind: 'report',
      location: 'artifacts/draft-report-2.json',
      artifactId: 'artifact-art-2',
    };
    const savedFirst: SavedEvent = {
      id: 'saved-1',
      kind: 'saved',
      artifactId: 'artifact-art-1',
      artifactName: 'Draft report',
      savedAt: '2026-07-28T00:00:00.000Z',
    };
    const { onSave } = renderEvents([first, second, savedFirst]);

    const saveButtons = screen.getAllByRole('button', { name: /save to artifacts|saved/i });
    expect(saveButtons).toHaveLength(2);

    // The saved artifact's card is disabled and reads "Saved"...
    const savedButton = screen.getByRole('button', { name: /saved/i });
    expect(savedButton).toBeDisabled();

    // ...but the never-saved sibling still offers a real, enabled Save action.
    const stillSaveable = screen.getByRole('button', { name: /save to artifacts/i });
    expect(stillSaveable).toBeEnabled();
    await user.click(stillSaveable);
    expect(onSave).toHaveBeenCalledWith('art-2');
    expect(onSave).not.toHaveBeenCalledWith('art-1');
  });

  it('offers Save to Artifacts again after an UnsavedEvent follows the SavedEvent (proves latest-wins recomputation, e.g. on reload after Unpin)', async () => {
    const user = userEvent.setup();
    const artifact: ArtifactEvent = {
      id: 'art-1',
      kind: 'artifact',
      name: 'Draft report',
      artifactKind: 'report',
      location: 'artifacts/draft-report.json',
      artifactId: 'artifact-art-1',
    };
    const saved: SavedEvent = {
      id: 'saved-1',
      kind: 'saved',
      artifactId: 'artifact-art-1',
      artifactName: 'Draft report',
      savedAt: '2026-07-28T00:00:00.000Z',
    };
    const unsaved: UnsavedEvent = {
      id: 'unsaved-1',
      kind: 'unsaved',
      artifactId: 'artifact-art-1',
      artifactName: 'Draft report',
      unsavedAt: '2026-07-28T00:05:00.000Z',
    };
    // Simulates reloading the Ask session after an Unpin: all three events
    // arrive together via a replayed events list, latest (unsaved) last.
    const { onSave } = renderEvents([artifact, saved, unsaved]);

    expect(screen.queryByRole('button', { name: /saved/i })).not.toBeInTheDocument();
    const saveButton = screen.getByRole('button', { name: /save to artifacts/i });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);
    expect(onSave).toHaveBeenCalledWith('art-1');
  });

  it('unpinning one of two same-named artifacts leaves the other saved (UnsavedEvent must key on artifactId, not name)', () => {
    const first: ArtifactEvent = {
      id: 'art-1',
      kind: 'artifact',
      name: 'Draft report',
      artifactKind: 'report',
      location: 'artifacts/draft-report-1.json',
      artifactId: 'artifact-art-1',
    };
    const second: ArtifactEvent = {
      id: 'art-2',
      kind: 'artifact',
      name: 'Draft report',
      artifactKind: 'report',
      location: 'artifacts/draft-report-2.json',
      artifactId: 'artifact-art-2',
    };
    const savedFirst: SavedEvent = {
      id: 'saved-1',
      kind: 'saved',
      artifactId: 'artifact-art-1',
      artifactName: 'Draft report',
      savedAt: '2026-07-28T00:00:00.000Z',
    };
    const savedSecond: SavedEvent = {
      id: 'saved-2',
      kind: 'saved',
      artifactId: 'artifact-art-2',
      artifactName: 'Draft report',
      savedAt: '2026-07-28T00:00:00.000Z',
    };
    // Both were saved, then only the first was unpinned.
    const unsavedFirst: UnsavedEvent = {
      id: 'unsaved-1',
      kind: 'unsaved',
      artifactId: 'artifact-art-1',
      artifactName: 'Draft report',
      unsavedAt: '2026-07-28T00:05:00.000Z',
    };
    renderEvents([first, second, savedFirst, savedSecond, unsavedFirst]);

    // The unpinned artifact's card is enabled again...
    const saveButton = screen.getByRole('button', { name: /save to artifacts/i });
    expect(saveButton).toBeEnabled();
    // ...but its still-saved sibling stays disabled and reads "Saved".
    const savedButton = screen.getByRole('button', { name: /saved/i });
    expect(savedButton).toBeDisabled();
  });

  it("renders a completed turn's persisted trace collapsed by default, expanding to reveal its steps", async () => {
    const user = userEvent.setup();
    // s1-e12 (forecast) carries a hand-authored `trace` — see fixtures.ts.
    const upToForecast = fixtureAskSessions.s1.events.findIndex((e) => e.id === 's1-e12');
    renderEvents(fixtureAskSessions.s1.events.slice(0, upToForecast + 1));

    const toggle = screen.getByRole('button', { name: 'Execution trace' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Collapsed: none of the trace's step labels are in the DOM yet.
    expect(screen.queryByText('Query verified history')).not.toBeInTheDocument();
    expect(screen.queryByText('Delegate: forecast sub-agent')).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Query verified history')).toBeInTheDocument();
    expect(screen.getByText('Delegate: forecast sub-agent')).toBeInTheDocument();
    expect(screen.getByText('Fit trend model')).toBeInTheDocument();
    // The Route decision's reasoning is shown inline once expanded, same as always.
    expect(screen.getByText('→ forecast: forecasting intent (next quarter)')).toBeInTheDocument();
  });

  it('omits the trace disclosure entirely for an answer with no trace', () => {
    const upToFirstAnswer = fixtureAskSessions.s1.events.findIndex((e) => e.id === 's1-e2');
    renderEvents(fixtureAskSessions.s1.events.slice(0, upToFirstAnswer + 1));
    expect(screen.queryByRole('button', { name: 'Execution trace' })).not.toBeInTheDocument();
  });

  it('hides the publish button and the published card even when a matching PublishedEvent exists', () => {
    const artifact: ArtifactEvent = {
      id: 'art-1',
      kind: 'artifact',
      name: 'Draft report',
      artifactKind: 'report',
      location: 'artifacts/draft-report.json',
      artifactId: 'artifact-art-1',
    };
    const published: PublishedEvent = {
      id: 'pub-1',
      kind: 'published',
      artifactName: 'Draft report',
      link: 'https://share.genbi.example/draft-report',
      scope: 'workspace',
    };
    renderEvents([artifact, published]);

    // `PUBLISH_UI_ENABLED` is off: no publish/published button, and the
    // published card (link + access scope) is dropped entirely. The artifact
    // card itself still renders with its location. Restore the positive
    // assertions when publishing really hosts the artifact.
    expect(screen.queryByRole('button', { name: /published/i })).not.toBeInTheDocument();
    expect(screen.queryByText('https://share.genbi.example/draft-report')).not.toBeInTheDocument();
    expect(screen.queryByText('workspace')).not.toBeInTheDocument();
    expect(screen.getByText('artifacts/draft-report.json')).toBeInTheDocument();
  });
});
