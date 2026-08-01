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

vi.mock('@/bff/client', () => ({
  getContextOverview: (...args: unknown[]) => getContextOverview(...args),
  getContextFiles: (...args: unknown[]) => getContextFiles(...args),
  getContextImpact: (...args: unknown[]) => getContextImpact(...args),
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
});
