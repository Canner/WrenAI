import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { AppRoutes } from '@/app/App';
import { t } from '@/i18n/strings';
import { useHarnessStore, BOUND_PROFILE_KEY } from '../useHarnessStore';
import { fixtureHarnessView } from '../fixtures';

/** Scope a query to one panel's Card (title + body), since values like a
 * tier-bound model or a capability id are legitimately echoed in more than
 * one panel on this single-scroll page. */
function getPanelByTitle(title: string): HTMLElement {
  const panel = screen.getByText(title).closest('.ant-card');
  if (!panel) throw new Error(`panel not found: ${title}`);
  return panel as HTMLElement;
}

beforeEach(() => {
  useHarnessStore.setState(
    { selectedProfileKey: BOUND_PROFILE_KEY, harness: undefined, loading: false, error: undefined },
    false,
  );
});

describe('Harness page (fixture mode)', () => {
  it('lists the bound profile plus a disabled Phase-3 placeholder in the sidebar', () => {
    renderWithProviders(<AppRoutes />, { route: '/harness' });

    const sidebar = screen.getByRole('navigation', { name: 'Profiles' });
    expect(within(sidebar).getByText(fixtureHarnessView.profile.name)).toBeInTheDocument();

    const placeholder = within(sidebar).getByText('Forecast Trend');
    expect(placeholder.closest('button')).toBeDisabled();
  });

  it('renders the profile panel: source, bound context, verify gate, compiled bundle (no fabricated timestamp)', () => {
    renderWithProviders(<AppRoutes />, { route: '/harness' });

    expect(screen.getByText(`warble · IR v${fixtureHarnessView.profile.irVersion}`)).toBeInTheDocument();
    expect(screen.getByText(fixtureHarnessView.profile.boundContext)).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(
      screen.getByText(
        `${fixtureHarnessView.profile.bundleId} · v${fixtureHarnessView.profile.bundleVersion} · ${fixtureHarnessView.profile.bundleHash}`,
      ),
    ).toBeInTheDocument();
    // The old "last compiled" wording must never appear.
    expect(screen.queryByText(/last compiled/i)).not.toBeInTheDocument();
  });

  it('renders the runtime · back-end panel with the tier→model table', () => {
    renderWithProviders(<AppRoutes />, { route: '/harness' });

    // Scoped: the strong-tier model is also echoed on the orchestrator row of
    // the agent profiles table further down the page.
    const runtimePanel = getPanelByTitle(t('harness.runtimeTitle'));
    expect(within(runtimePanel).getByText(fixtureHarnessView.runtime.label)).toBeInTheDocument();
    expect(within(runtimePanel).getByText('claude-haiku')).toBeInTheDocument();
    expect(within(runtimePanel).getByText('claude-sonnet')).toBeInTheDocument();
    // Subscription is the fixture's active back-end — the api-key "Also
    // available" alternate is internal detail and must not render.
    expect(within(runtimePanel).queryByText(t('harness.alsoAvailable'))).not.toBeInTheDocument();
  });

  it('renders the agent profiles table with the orchestrator row and a greyed Phase-3 sub-agent row', () => {
    renderWithProviders(<AppRoutes />, { route: '/harness' });

    // The profile name is also echoed in the sidebar/lead/profile panel — scope
    // to the orchestrator's own row in this table.
    const rows = screen.getAllByRole('row');
    const orchestratorRow = rows.find((row) => within(row).queryByText('Orchestrator'));
    expect(orchestratorRow).toBeDefined();
    expect(within(orchestratorRow!).getByText(fixtureHarnessView.profile.name)).toBeInTheDocument();

    // "Planned (Phase 3)" is also echoed as the sidebar placeholder's meta —
    // scope this one to the sub-agent's own row in the table.
    const subAgentRow = rows.find((row) => within(row).queryByText('Sub-agent'));
    expect(subAgentRow).toBeDefined();
    expect(within(subAgentRow!).getByText('Planned (Phase 3)')).toBeInTheDocument();
  });

  it('renders the connection panel with the generic type/via labels', () => {
    renderWithProviders(<AppRoutes />, { route: '/harness' });

    expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
    expect(screen.getByText('analytics-prod')).toBeInTheDocument();
    expect(screen.getByText('query engine')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('renders the components table with the 4 real agents, expandable to tools/output blocks/step dataflow', async () => {
    renderWithProviders(<AppRoutes />, { route: '/harness' });

    expect(screen.getByText('Explore Model')).toBeInTheDocument();
    expect(screen.getByText('Answer Query')).toBeInTheDocument();
    expect(screen.getByText('Generate Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Explain Change')).toBeInTheDocument();

    // Expand a row (AntD renders an expand toggle per row) to reveal tools/output blocks/step dataflow.
    const rows = screen.getAllByRole('row');
    const answerQueryRow = rows.find((row) => within(row).queryByText('Answer Query'));
    expect(answerQueryRow).toBeDefined();
    const expandToggle = within(answerQueryRow!).getByRole('button');
    expandToggle.click();

    expect(await screen.findByText('query')).toBeInTheDocument();
    expect(screen.getByText('table')).toBeInTheDocument();
    expect(screen.getByText('generate_sql')).toBeInTheDocument();
    expect(screen.getByText('repair_sql')).toBeInTheDocument();
    expect(screen.getByText('repair_fold')).toBeInTheDocument();
  });

  it('renders the capability resolution table deduped, with raw warble-native ids', () => {
    renderWithProviders(<AppRoutes />, { route: '/harness' });

    // `sql_execution:read_only` is declared by 3 components (and echoed again on
    // the orchestrator's row above) but appears once in this table's own dedup.
    const capabilityPanel = getPanelByTitle(t('harness.capabilityResolutionTitle'));
    expect(within(capabilityPanel).getAllByText('sql_execution:read_only')).toHaveLength(1);
    expect(within(capabilityPanel).getAllByText('Native').length).toBeGreaterThan(0);
    expect(within(capabilityPanel).getAllByText('Realize via').length).toBeGreaterThan(0);
  });

  it('renders the guardrails list deduped, with enforcement + locked/threshold', () => {
    renderWithProviders(<AppRoutes />, { route: '/harness' });

    // `read_only_execution` is declared by all 4 components but appears once here.
    expect(screen.getAllByText('read_only_execution')).toHaveLength(1);
    expect(screen.getByText('row_limit')).toBeInTheDocument();
    expect(screen.getByText('1000')).toBeInTheDocument();
  });

  it('renders the synthetic monitor_freshness component with its assertive/tool/scheduled anatomy', async () => {
    renderWithProviders(<AppRoutes />, { route: '/harness' });

    expect(screen.getByText('Monitor Freshness')).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    const monitorRow = rows.find((row) => within(row).queryByText('Monitor Freshness'));
    expect(monitorRow).toBeDefined();
    expect(within(monitorRow!).getByText('assertive')).toBeInTheDocument();
    expect(within(monitorRow!).getByText('tool · scheduled')).toBeInTheDocument();

    // Expand the row to reveal the conditional step and the assertion outcome.
    const expandToggle = within(monitorRow!).getByRole('button');
    expandToggle.click();

    expect(await screen.findByText('assess_severity')).toBeInTheDocument();
    expect(screen.getByText(/on_flag/)).toBeInTheDocument();
    expect(screen.getByText(t('harness.outcomeLabel') + ':')).toBeInTheDocument();
    expect(screen.getByText('assertion')).toBeInTheDocument();
  });

  it('shows no outcome for the analytical (outcome: none) components', async () => {
    renderWithProviders(<AppRoutes />, { route: '/harness' });

    const rows = screen.getAllByRole('row');
    const answerQueryRow = rows.find((row) => within(row).queryByText('Answer Query'));
    expect(answerQueryRow).toBeDefined();
    within(answerQueryRow!).getByRole('button').click();

    // The step dataflow renders once expanded, but no outcome tag is shown.
    expect(await screen.findByText('generate_sql')).toBeInTheDocument();
    expect(screen.queryByText(t('harness.outcomeLabel') + ':')).not.toBeInTheDocument();
  });

  it('renders every Phase-3 affordance as a disabled button with a planned hint', () => {
    renderWithProviders(<AppRoutes />, { route: '/harness' });

    expect(screen.getByRole('button', { name: /Re-compile/ })).toBeDisabled();
    // "Add profile" appears twice by design: a page-header quick action plus
    // the Agent profiles panel's own action — both disabled Phase-3 stubs.
    const addProfileButtons = screen.getAllByRole('button', { name: /Add profile/ });
    expect(addProfileButtons).toHaveLength(2);
    for (const button of addProfileButtons) expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: /Import from warble Hub/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Re-sync tables' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Manage source' })).toBeDisabled();
  });
});
