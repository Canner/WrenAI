import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
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
}));

import { useHarnessStore, BOUND_PROFILE_KEY } from '../useHarnessStore';

const liveHarness: HarnessView = {
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
};

beforeEach(() => {
  getHarness.mockReset();
  useHarnessStore.setState(
    { selectedProfileKey: BOUND_PROFILE_KEY, harness: undefined, loading: false, error: undefined },
    false,
  );
});

describe('Harness page (live mode)', () => {
  it('renders the fetched harness profile', async () => {
    getHarness.mockResolvedValueOnce(liveHarness);

    renderWithProviders(<AppRoutes />, { route: '/harness' });

    expect(await screen.findByText('acme-wren')).toBeInTheDocument();
    expect(screen.getByText(/API key \(anthropic\)/)).toBeInTheDocument();
    // `claude-sonnet` is also echoed on the orchestrator's row in the agent
    // profiles table — scope this assertion to the tier→model table itself.
    const runtimePanel = screen.getByText('Runtime · back-end').closest('.ant-card') as HTMLElement;
    expect(within(runtimePanel).getByText('claude-sonnet')).toBeInTheDocument();

    const sidebar = screen.getByRole('navigation', { name: 'Profiles' });
    expect(within(sidebar).getByText('Genbi Default')).toBeInTheDocument();
  });

  it('renders the fetched component in the components table', async () => {
    getHarness.mockResolvedValueOnce(liveHarness);

    renderWithProviders(<AppRoutes />, { route: '/harness' });

    expect(await screen.findByText('Answer Query')).toBeInTheDocument();

    // The capability id is also echoed on the agent profiles table and the
    // capability resolution table — scope to the component's own row.
    const rows = screen.getAllByRole('row');
    const answerQueryRow = rows.find((row) => within(row).queryByText('Answer Query'));
    expect(answerQueryRow).toBeDefined();
    expect(within(answerQueryRow!).getByText('sql_execution:read_only')).toBeInTheDocument();
  });
});
