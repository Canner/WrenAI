import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { AskSession } from '../AskSession';
import { useSessionStore } from '../useSessionStore';
import { fixtureAskSessions } from '../fixtures';

// ECharts needs a real canvas; stub it so chart-bearing rich answers render in jsdom.
vi.mock('echarts', () => ({
  init: () => ({ setOption() {}, resize() {}, dispose() {} }),
}));

// `useSessionStore` is a module-level singleton; reset it to a fresh clone of
// the fixtures before every test so sent messages / publishes in one test
// never leak into the next.
beforeEach(() => {
  useSessionStore.setState(
    {
      sessionsById: JSON.parse(JSON.stringify(fixtureAskSessions)),
      streaming: {},
      streamError: {},
    },
    false,
  );
});

describe('AskSession', () => {
  it('shows the empty state for a session with no events yet', () => {
    renderWithProviders(<AskSession sessionId="brand-new" />);
    expect(screen.getByText('Ask anything about your data')).toBeInTheDocument();
  });

  it('loads a resumed session’s prior events from fixtures', () => {
    renderWithProviders(<AskSession sessionId="s2" />);
    expect(screen.getByText('Monthly signups trend')).toBeInTheDocument();
    expect(screen.getByText('Why did revenue rise in July?')).toBeInTheDocument();
  });

  it('appends the user message and the fixture-stream answer on send', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AskSession sessionId="brand-new" />);

    await user.type(screen.getByLabelText('Ask a question'), 'Show me the top vendors by spend');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(screen.getByText('Show me the top vendors by spend')).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );
  });

  it("keeps a completed turn's trace disclosure in history after a follow-up turn completes", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AskSession sessionId="brand-new" />);

    await user.type(screen.getByLabelText('Ask a question'), 'Show me the top vendors by spend');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(
      () => {
        expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );

    // The first turn's trace is carried on its own AnswerEvent, collapsed by
    // default — not the raw live WorkLog view (which only shows while
    // `streaming`), so exactly one "Execution trace" disclosure exists so far.
    expect(screen.getAllByRole('button', { name: 'Execution trace' })).toHaveLength(1);
    const [firstTraceToggle] = screen.getAllByRole('button', { name: 'Execution trace' });
    expect(firstTraceToggle).toHaveAttribute('aria-expanded', 'false');

    // Send a follow-up turn in the same session.
    await user.type(screen.getByLabelText('Ask a question'), 'Now break that down by region please');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(
      () => {
        expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(1);
      },
      { timeout: 2000 },
    );

    // Both turns now have their own collapsed trace disclosure — the first
    // one's was not wiped by the second turn's `workLog` reset.
    const traceToggles = screen.getAllByRole('button', { name: 'Execution trace' });
    expect(traceToggles).toHaveLength(2);
    traceToggles.forEach((toggle) => expect(toggle).toHaveAttribute('aria-expanded', 'false'));

    // The first turn's trace still expands to its own content on demand.
    await user.click(traceToggles[0]);
    expect(screen.getByText('Parse question')).toBeInTheDocument();
  });

  it('degrades gracefully when the stream errors: shows an alert and offers retry', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AskSession sessionId="brand-new" />);

    await user.type(screen.getByLabelText('Ask a question'), 'trigger an error case');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(
      () => {
        expect(screen.getByText('The connection to the agent was lost')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    // No fabricated answer content should appear alongside the failure.
    expect(screen.queryByText('Acme Corp')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('records a publish in state but renders no publish affordances while publishing is unimplemented', async () => {
    useSessionStore.setState((s) => ({
      sessionsById: {
        ...s.sessionsById,
        'artifact-demo': {
          id: 'artifact-demo',
          title: 'Artifact demo',
          updatedAt: 'now',
          events: [
            {
              id: 'a-1',
              kind: 'artifact',
              name: 'Draft report',
              artifactKind: 'report',
              location: 'artifacts/draft-report.json',
              artifactId: 'artifact-a-1',
            },
          ],
          workLog: [],
        },
      },
    }));

    renderWithProviders(<AskSession sessionId="artifact-demo" />);

    // `PUBLISH_UI_ENABLED` is off: no CTA is offered for an action whose result
    // can't be opened.
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();

    // The store action that CTA used to drive still works, and keeps its
    // coverage here — but its result stays out of the UI. Restore the
    // click-driven version, with the link/scope assertions, when the flag flips.
    // Second arg is the artifact *event* id, not the artifactId.
    useSessionStore.getState().publishArtifact('artifact-demo', 'a-1');

    await waitFor(() =>
      expect(
        useSessionStore
          .getState()
          .sessionsById['artifact-demo'].events.some((e) => e.kind === 'published'),
      ).toBe(true),
    );
    expect(screen.queryByRole('button', { name: /published/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/share\.genbi\.example/)).not.toBeInTheDocument();
  });
});
