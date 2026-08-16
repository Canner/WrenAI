import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { AppRoutes } from '@/app/App';
import type { HarnessView } from '../types';

// Force the dispatcher down the live branch regardless of `VITE_BFF_URL`.
vi.mock('@/bff/env', () => ({
  isBffEnabled: () => true,
}));

const getHarness = vi.fn();

vi.mock('@/bff/client', () => ({
  getHarness: (...args: unknown[]) => getHarness(...args),
  getRuntimeSettingsReadiness: () => Promise.resolve({ valid: true as const }),
}));

import { useHarnessStore } from '../useHarnessStore';

const liveHarness: HarnessView = {
  purpose: { purpose: 'analysis', profile: 'genbi-default', scopeKind: 'bound_project', target: 'claude-code:interactive', targetLabel: 'Claude CLI', available: true },
  profile: {
    id: 'genbi-default',
    name: 'Genbi Default',
    boundContext: 'acme-wren',
    verifyGate: true,
    bundleId: 'genbi-default@vercel:headless',
    bundleVersion: '0.1',
    irVersion: '0.3',
    dispatchTarget: 'vercel:headless',
    bundleHash: '9c31a02',
    status: 'Bound',
  },
  runtime: {
    backend: 'api-key',
    label: 'API key (anthropic)',
    tierModels: [
      { tier: 'cheap', model: 'claude-haiku' },
      { tier: 'strong', model: 'claude-sonnet' },
    ],
  },
  connection: {
    type: 'PostgreSQL',
    location: 'analytics-prod',
    via: 'query engine',
    tablesSynced: 14,
    lastSync: '5m ago',
    health: 'healthy',
  },
  components: [
    {
      id: 'answer_query',
      name: 'Answer Query',
      componentType: 'analytical',
      realizationKind: 'skill',
      realizationLabel: 'skill · split',
      trigger: 'one_shot',
      outcome: 'none',
      callableAs: 'answer_query',
      model: 'claude-sonnet',
      tiers: [
        { tier: 'cheap', model: 'claude-haiku' },
        { tier: 'strong', model: 'claude-sonnet' },
      ],
      capabilities: [
        { capability: 'sql_execution:read_only', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
      ],
      guardrails: [{ name: 'read_only_execution', enforcement: 'read_only', locked: true }],
      tools: [{ name: 'query', source: 'mcp:sample/query' }],
      outputBlocks: ['table'],
      steps: [
        { name: 'resolve_intent', tier: 'cheap', consumes: [], produces: 'query_intent', realization: 'independent' },
      ],
      status: 'ready',
    },
  ],
  agentProfiles: [
    {
      name: 'Genbi Default',
      role: 'orchestrator',
      tierModel: 'claude-sonnet',
      capabilities: [
        { capability: 'sql_execution:read_only', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
      ],
      status: 'Bound',
    },
  ],
  nativeSessions: {
    binding: { configured: true, generation: 2, targetLabel: 'Claude CLI' },
    dispatches: [
      { purpose: 'setup', profile: 'genbi-setup', scopeKind: 'bootstrap', targetLabel: 'Claude CLI', available: true },
      { purpose: 'analysis', profile: 'genbi-default', scopeKind: 'bound_project', targetLabel: 'Claude CLI', available: true },
      { purpose: 'context_enrichment', profile: 'genbi-enrich-context', scopeKind: 'bound_project', targetLabel: 'Claude CLI', available: true },
    ],
  },
};

beforeEach(() => {
  getHarness.mockReset();
  useHarnessStore.setState(
    { selectedPurpose: 'analysis', harness: undefined, loading: false, error: undefined },
    false,
  );
});

describe('Harness page (live mode)', () => {
  it('renders the fetched harness profile', async () => {
    getHarness.mockResolvedValueOnce(liveHarness);

    renderWithProviders(<AppRoutes />, { route: '/harness' });

    expect(await screen.findByText('Answer Query')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Profile and compiled bundle/ }));
    expect(screen.getByText('acme-wren')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Runtime and model binding/ }));
    expect(screen.getByText(/API key \(anthropic\)/)).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet')).toBeInTheDocument();

    const sidebar = screen.getByRole('navigation', { name: 'Profiles' });
    expect(within(sidebar).getByText('Setup')).toBeInTheDocument();
    expect(within(sidebar).getByText('Analyze data')).toBeInTheDocument();
    expect(within(sidebar).getByText('Context enrichment')).toBeInTheDocument();
  });

  it('renders the fetched component in the components table', async () => {
    getHarness.mockResolvedValueOnce(liveHarness);

    renderWithProviders(<AppRoutes />, { route: '/harness' });

    expect(await screen.findByText('Answer Query')).toBeInTheDocument();

    // Callable-as remains an executable component detail in the primary table.
    const rows = screen.getAllByRole('row');
    const answerQueryRow = rows.find((row) => within(row).queryByText('Answer Query'));
    expect(answerQueryRow).toBeDefined();
    expect(within(answerQueryRow!).getByText('answer_query')).toBeInTheDocument();
  });

  it('separately labels the compiled dispatch and native interactive-session targets', async () => {
    getHarness.mockResolvedValueOnce(liveHarness);

    renderWithProviders(<AppRoutes />, { route: '/harness' });

    const panel = (await screen.findByText('Execution path')).closest('.ant-card') as HTMLElement;
    expect(panel).toHaveTextContent('analysis');
    expect(panel).toHaveTextContent('genbi-default');
    expect(panel).toHaveTextContent('Compiled dispatch target');
    expect(panel).toHaveTextContent('vercel:headless');
    expect(panel).toHaveTextContent('Native session target');
    expect(panel).toHaveTextContent('Claude CLI');
  });

  it('switches profiles without retaining analysis detail and fences a late analysis response', async () => {
    let resolveAnalysis!: (value: HarnessView) => void;
    const analysis = new Promise<HarnessView>((resolve) => {
      resolveAnalysis = resolve;
    });
    const setup: HarnessView = {
      ...liveHarness,
      purpose: { purpose: 'setup', profile: 'genbi-setup', scopeKind: 'bootstrap', target: 'claude-code:interactive', targetLabel: 'Claude CLI', available: true },
      profile: { ...liveHarness.profile, id: 'genbi-setup', name: 'Genbi Setup', bundleId: 'genbi-setup@vercel:headless' },
      components: [{ ...liveHarness.components[0], id: 'connect_source', name: 'Connect Source', callableAs: 'connect_source' }],
      agentProfiles: [{ ...liveHarness.agentProfiles[0], name: 'Genbi Setup' }],
    };
    getHarness.mockImplementation((purpose: string) => (purpose === 'analysis' ? analysis : Promise.resolve(setup)));

    renderWithProviders(<AppRoutes />, { route: '/harness' });
    fireEvent.click(screen.getByRole('button', { name: /Setup/ }));

    expect(await screen.findByText('Connect Source')).toBeInTheDocument();
    expect(screen.getAllByText('genbi-setup')).not.toHaveLength(0);
    expect(screen.queryByText('Answer Query')).not.toBeInTheDocument();
    resolveAnalysis(liveHarness);
    await Promise.resolve();
    expect(screen.getByText('Connect Source')).toBeInTheDocument();
    expect(screen.queryByText('Answer Query')).not.toBeInTheDocument();
  });

  it('loads the context-enrichment purpose as its own profile', async () => {
    const context: HarnessView = {
      ...liveHarness,
      purpose: { purpose: 'context_enrichment', profile: 'genbi-enrich-context', scopeKind: 'bound_project', target: 'claude-code:interactive', targetLabel: 'Claude CLI', available: true },
      profile: { ...liveHarness.profile, id: 'genbi-enrich-context', name: 'Genbi Enrich Context', bundleId: 'genbi-enrich-context@vercel:headless' },
      components: [{ ...liveHarness.components[0], id: 'draft_enrichment', name: 'Draft Enrichment', callableAs: 'draft_enrichment' }],
      agentProfiles: [{ ...liveHarness.agentProfiles[0], name: 'Genbi Enrich Context' }],
    };
    getHarness.mockImplementation((purpose: string) => Promise.resolve(purpose === 'context_enrichment' ? context : liveHarness));

    renderWithProviders(<AppRoutes />, { route: '/harness' });
    expect(await screen.findByText('Answer Query')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Context enrichment/ }));

    expect(await screen.findByText('Draft Enrichment')).toBeInTheDocument();
    expect(screen.getAllByText('genbi-enrich-context')).not.toHaveLength(0);
    expect(screen.queryByText('Answer Query')).not.toBeInTheDocument();
  });
});
