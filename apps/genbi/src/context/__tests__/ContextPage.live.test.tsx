import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { AppRoutes } from '@/app/App';
import type { ContextFileNode, ContextOverviewData, ImpactData } from '../types';

// Force the dispatcher down the live branch regardless of `VITE_BFF_URL`.
vi.mock('@/bff/env', () => ({
  isBffEnabled: () => true,
}));

const getContextOverview = vi.fn();
const getContextFiles = vi.fn();
const getContextImpact = vi.fn();
const getContextEnrichment = vi.fn();
const postEnrichmentDecision = vi.fn();
const postEnrichmentEdit = vi.fn();
const postEnrichmentApproval = vi.fn();
const postEnrichmentCancel = vi.fn();
const postEnrichmentRetry = vi.fn();
const postEnrichmentReapply = vi.fn();
const startContextEnrichment = vi.fn();
const getNativeSessionReadiness = vi.fn().mockResolvedValue({
  runtime: { configured: true, generation: 3, provider: 'claude', target: 'claude-code:interactive', targetLabel: 'Claude CLI' },
  purposes: {
    context_enrichment: { scopeKind: 'bound_project', profile: 'genbi-enrich-context', target: 'claude-code:interactive', targetLabel: 'Claude CLI', available: true },
  },
});
const createNativeSession = vi.fn();

vi.mock('@/bff/client', () => ({
  getContextOverview: (...args: unknown[]) => getContextOverview(...args),
  getContextFiles: (...args: unknown[]) => getContextFiles(...args),
  getContextImpact: (...args: unknown[]) => getContextImpact(...args),
  getContextEnrichment: (...args: unknown[]) => getContextEnrichment(...args),
  postEnrichmentDecision: (...args: unknown[]) => postEnrichmentDecision(...args),
  postEnrichmentEdit: (...args: unknown[]) => postEnrichmentEdit(...args),
  postEnrichmentApproval: (...args: unknown[]) => postEnrichmentApproval(...args),
  postEnrichmentCancel: (...args: unknown[]) => postEnrichmentCancel(...args),
  postEnrichmentRetry: (...args: unknown[]) => postEnrichmentRetry(...args),
  postEnrichmentReapply: (...args: unknown[]) => postEnrichmentReapply(...args),
  startContextEnrichment: (...args: unknown[]) => startContextEnrichment(...args),
  getNativeSessionReadiness: (...args: unknown[]) => getNativeSessionReadiness(...args),
  createNativeSession: (...args: unknown[]) => createNativeSession(...args),
  getRuntimeSettingsReadiness: () => Promise.resolve({ valid: true as const }),
}));

import { useContextStore } from '../useContextStore';

// A semantic layer deliberately disjoint from the fixtures (different model
// and relationship names) so any test that accidentally reads fixture data
// instead of the live overview fails loudly rather than by coincidence.
const liveOverview: ContextOverviewData = {
  projectName: 'my-live-project',
  projectPath: '/Users/you/wren-projects/my-live-project',
  // No `position` on either model — mirrors the real BFF DTO for a live
  // project (see `SemanticModel.position`), so this suite exercises the same
  // computed-layout path `ErDiagram` uses for real projects.
  models: [
    {
      key: 'model.widgets',
      name: 'widgets',
      columns: [{ name: 'widget_id', type: 'varchar', key: 'pk' }],
    },
    {
      key: 'model.shops',
      name: 'shops',
      columns: [{ name: 'shop_id', type: 'varchar', key: 'pk' }],
    },
  ],
  relationships: [
    {
      key: 'relationship.widgets_shops',
      name: 'widgets_shops',
      fromModel: 'model.widgets',
      toModel: 'model.shops',
      type: 'many-to-one',
    },
  ],
  measures: [
    {
      key: 'measure.widget_count',
      name: 'widget_count',
      baseModel: 'model.widgets',
      expression: 'COUNT(*)',
      additivity: 'additive',
    },
  ],
  knowledge: { instructionsPresent: false, verifiedPairCount: 7 },
};

// Flat top-level array (category folders only) — no wrapping `wren_project`
// root, matching the live `GET /api/context/files` shape.
const liveFiles: ContextFileNode[] = [
  {
    key: 'dir.models',
    title: 'models',
    children: [
      {
        key: 'model.widgets',
        title: 'widgets.model.yaml',
        kind: 'model',
        path: 'wren_project/models/widgets.model.yaml',
        content: 'name: widgets\n',
        entityKey: 'model.widgets',
      },
    ],
  },
  {
    key: 'dir.knowledge',
    title: 'knowledge',
    children: [
      {
        key: 'knowledge.biz',
        title: 'biz.md',
        kind: 'knowledge',
        path: 'wren_project/knowledge/biz.md',
        content: '# biz context\n',
      },
    ],
  },
];

beforeEach(() => {
  getContextOverview.mockReset();
  getContextFiles.mockReset();
  getContextImpact.mockReset();
  getContextEnrichment.mockReset();
  postEnrichmentDecision.mockReset();
  postEnrichmentEdit.mockReset();
  postEnrichmentApproval.mockReset();
  postEnrichmentCancel.mockReset();
  postEnrichmentRetry.mockReset();
  postEnrichmentReapply.mockReset();
  startContextEnrichment.mockReset();
  window.sessionStorage.clear();
  getContextEnrichment.mockResolvedValue({ available: false });
  useContextStore.setState(
    {
      viewMode: 'overview',
      selectedFileKey: undefined,
      impactSeedKey: undefined,
      liveImpactByKey: {},
      impactError: undefined,
      liveOverview: undefined,
      overviewLoading: false,
      overviewError: undefined,
      liveFiles: undefined,
      filesLoading: false,
      filesError: undefined,
      enrichment: undefined,
      enrichmentLoading: false,
      enrichmentError: undefined,
    },
    false,
  );
});

describe('Context page (live mode)', () => {
  it('renders the Overview ER diagram and stats from the live overview fetch', async () => {
    getContextOverview.mockResolvedValueOnce(liveOverview);
    getContextFiles.mockResolvedValueOnce(liveFiles);

    renderWithProviders(<AppRoutes />, { route: '/context' });

    expect(await screen.findByText('widgets')).toBeInTheDocument();
    const toolbar = document.querySelector('.genbi-mdl-toolbar');
    expect(toolbar).toHaveTextContent('2 models');
    expect(toolbar).toHaveTextContent('1 relationships');
    expect(toolbar).toHaveTextContent('1 measures');
    const widgetsNode = document.querySelector('[data-testid="er-node-model.widgets"]') as HTMLElement;
    const shopsNode = document.querySelector('[data-testid="er-node-model.shops"]') as HTMLElement;
    expect(widgetsNode).toBeInTheDocument();
    expect(shopsNode).toBeInTheDocument();
    // Neither model carries `position` — the ER diagram must have computed a
    // layout from the relationship graph rather than defaulting both to the
    // same spot.
    expect(`${widgetsNode.style.left},${widgetsNode.style.top}`).not.toBe(
      `${shopsNode.style.left},${shopsNode.style.top}`,
    );
    expect(document.querySelector('[data-testid="er-edge-relationship.widgets_shops"]')).toBeInTheDocument();
    // Fixture-only model must not leak into the live render.
    expect(screen.queryByText('customers')).not.toBeInTheDocument();

    // Project identity header shows the live project's name + bound path,
    // not the offline fixture project.
    expect(screen.getByText('my-live-project')).toBeInTheDocument();
    expect(screen.getByText('/Users/you/wren-projects/my-live-project')).toBeInTheDocument();
  });

  it('softens the verified-pairs stat to "Not tracked" when the live project reports zero (real projects always do)', async () => {
    getContextOverview.mockResolvedValueOnce({
      ...liveOverview,
      knowledge: { instructionsPresent: true, verifiedPairCount: 0 },
    });
    getContextFiles.mockResolvedValueOnce(liveFiles);

    renderWithProviders(<AppRoutes />, { route: '/context' });

    expect(await screen.findByText('Not tracked')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows a "not bound" hint instead of a blank path when the live project has no bound projectPath', async () => {
    getContextOverview.mockResolvedValueOnce({ ...liveOverview, projectPath: '' });
    getContextFiles.mockResolvedValueOnce(liveFiles);

    renderWithProviders(<AppRoutes />, { route: '/context' });

    expect(await screen.findByText('my-live-project')).toBeInTheDocument();
    expect(screen.getByText('Not bound to a filesystem path')).toBeInTheDocument();
    expect(document.querySelector('.genbi-project-path')).not.toHaveTextContent('Project path:');
  });

  it('renders the live file tree in the sidebar without a wrapping wren_project root', async () => {
    getContextOverview.mockResolvedValueOnce(liveOverview);
    getContextFiles.mockResolvedValueOnce(liveFiles);

    renderWithProviders(<AppRoutes />, { route: '/context' });

    const sidebar = screen.getByRole('navigation', { name: 'Files' });
    expect(await within(sidebar).findByText('widgets.model.yaml')).toBeInTheDocument();
    expect(within(sidebar).getByText('biz.md')).toBeInTheDocument();
    // No wrapping project-root label — the live DTO's top level is already
    // the category folders, unlike the fixture tree.
    expect(within(sidebar).queryByText('wren_project')).not.toBeInTheDocument();
    // Fixture-only file must not leak into the live render.
    expect(within(sidebar).queryByText('orders.model.yaml')).not.toBeInTheDocument();
  });

  it('selecting a live file shows its fetched content in the canvas', async () => {
    getContextOverview.mockResolvedValueOnce(liveOverview);
    getContextFiles.mockResolvedValueOnce(liveFiles);
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { route: '/context' });

    const sidebar = screen.getByRole('navigation', { name: 'Files' });
    await user.click(await within(sidebar).findByText('widgets.model.yaml'));

    expect(await screen.findByText(/name: widgets/)).toBeInTheDocument();
  });

  it('the Edit CLI prompt names the live project, not the offline fixture project', async () => {
    getContextOverview.mockResolvedValueOnce(liveOverview);
    getContextFiles.mockResolvedValueOnce(liveFiles);
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { route: '/context' });

    const sidebar = screen.getByRole('navigation', { name: 'Files' });
    await user.click(await within(sidebar).findByText('widgets.model.yaml'));

    await user.click(await screen.findByRole('button', { name: /Edit/ }));
    await user.click(screen.getByText('Claude Code CLI'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('my-live-project');
    expect(dialog).not.toHaveTextContent('acme-genbi');
  });

  it('coherence: Impact view derives its ER diagram and affected models from the same live overview, not fixtures', async () => {
    getContextOverview.mockResolvedValueOnce(liveOverview);
    getContextFiles.mockResolvedValueOnce(liveFiles);
    getContextImpact.mockResolvedValueOnce({
      blastRadius: {
        seed: { key: 'model.widgets', name: 'widgets', kind: 'model' },
        downstream: [{ key: 'relationship.widgets_shops', name: 'widgets_shops', kind: 'relationship' }],
        severity: 'structural',
      },
      brokenPairs: [],
    } satisfies ImpactData);

    renderWithProviders(<AppRoutes />, { route: '/context' });

    const widgetsNode = await screen.findByRole('button', { name: /View impact: widgets/ });
    const user = userEvent.setup();
    await user.click(widgetsNode);

    await waitFor(() => {
      expect(document.querySelector('[data-testid="er-node-model.shops"]')).toHaveClass('is-affected');
    });
    // The embedded ER diagram in the Impact view uses the live models/edges —
    // never falls back to the fixture's disjoint `orders`/`customers` layer.
    expect(document.querySelector('[data-testid="er-node-model.customers"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="er-node-model.widgets"]')).toBeInTheDocument();
  });

  it('discards stale enrichment polling snapshots by binding generation and run version', async () => {
    let resolveOlder!: (value: unknown) => void;
    const older = new Promise<unknown>((resolve) => { resolveOlder = resolve; });
    const newer = { available: true, run: { id: 'run-1', mode: 'grill', projectRevision: 'rev', bindingGeneration: 4, version: 3, proposalId: 'proposal', proposalHash: 'hash', status: 'ready', createdAt: 'now', updatedAt: 'now', operations: [], events: [], audit: { applied: [], skipped: [] } } };
    const staleVersion = { ...newer, run: { ...newer.run, version: 2 } };
    const stale = { ...newer, run: { ...newer.run, bindingGeneration: 3, version: 99 } };
    getContextEnrichment.mockImplementationOnce(() => older).mockResolvedValueOnce(newer).mockResolvedValueOnce(staleVersion).mockResolvedValueOnce(stale);

    useContextStore.getState().loadEnrichment();
    useContextStore.getState().loadEnrichment();
    await waitFor(() => expect(useContextStore.getState().enrichment?.run?.version).toBe(3));
    resolveOlder(staleVersion);
    await Promise.resolve();
    expect(useContextStore.getState().enrichment?.run).toMatchObject({ bindingGeneration: 4, version: 3 });

    useContextStore.getState().loadEnrichment();
    await waitFor(() => expect(useContextStore.getState().enrichment?.run).toMatchObject({ bindingGeneration: 4, version: 3 }));
    useContextStore.getState().loadEnrichment();
    await waitFor(() => expect(useContextStore.getState().enrichment?.run).toMatchObject({ bindingGeneration: 4, version: 3 }));
  });

  it('offers Sessions enrichment continuation instead of the legacy proposal-edit form', async () => {
    getContextOverview.mockResolvedValueOnce(liveOverview);
    getContextFiles.mockResolvedValueOnce(liveFiles);
    const run = {
      id: 'run-edit', mode: 'grill' as const, projectRevision: 'rev', bindingGeneration: 4, version: 5, proposalId: 'proposal', proposalHash: 'hash', status: 'awaiting_decision' as const, createdAt: 'now', updatedAt: 'now',
      operations: [{ id: 'op-edit', sink: 'knowledge/glossary.md', risk: 'low' as const, summary: 'Add a margin term', draft: 'Term: margin', changeKind: 'knowledge_append' as const, confidence: 'high', decision: 'edit' as const, completed: false, state: 'awaiting_decision' as const }],
      events: [], audit: { entries: [{ operationId: 'op-edit', sink: 'knowledge/glossary.md', confidence: 'high', summary: 'Add a margin term' }], history: [] },
    };
    getContextEnrichment.mockResolvedValue({ available: true, capabilities: { draft: { available: true }, apply: { available: true }, approval: { available: true }, reconcile: { available: true } }, run });
    renderWithProviders(<AppRoutes />, { route: '/context' });
    expect(await screen.findByRole('button', { name: 'Start separate Claude CLI session' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start separate Codex/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });
});
