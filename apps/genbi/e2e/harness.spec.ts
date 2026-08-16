import { expect, test } from '@playwright/test';

type Purpose = 'setup' | 'analysis' | 'context_enrichment';

const CASES: Array<{ purpose: Purpose; available: boolean }> = [
  { purpose: 'setup', available: true },
  { purpose: 'setup', available: false },
  { purpose: 'analysis', available: true },
  { purpose: 'analysis', available: false },
  { purpose: 'context_enrichment', available: true },
  { purpose: 'context_enrichment', available: false },
];

function profileFor(purpose: Purpose) {
  return purpose === 'setup' ? 'genbi-setup' : purpose === 'analysis' ? 'genbi-default' : 'genbi-enrich-context';
}

function componentFor(purpose: Purpose) {
  return purpose === 'setup' ? 'Connect Source' : purpose === 'analysis' ? 'Answer Query' : 'Draft Enrichment';
}

function harnessResponse(purpose: Purpose, available: boolean) {
  const profile = profileFor(purpose);
  const componentName = componentFor(purpose);
  const reason = `Native ${purpose.replace('_', ' ')} is unavailable.`;

  return {
    purpose: {
      purpose,
      profile,
      scopeKind: purpose === 'setup' ? 'bootstrap' : 'bound_project',
      target: 'claude-code:interactive',
      targetLabel: 'Claude CLI',
      available,
      ...(!available ? { reason } : {}),
    },
    profile: {
      id: profile,
      name: profile,
      boundContext: purpose === 'setup' ? 'Bootstrap workspace' : 'browser-project',
      verifyGate: true,
      bundleId: `${profile}@vercel:headless`,
      bundleVersion: '0.1',
      irVersion: '0.4',
      dispatchTarget: 'vercel:headless',
      bundleHash: 'browser1',
      status: 'Bound',
    },
    runtime: {
      backend: 'subscription',
      label: 'Subscription (claude)',
      tierModels: [{ tier: 'strong', model: 'claude-sonnet' }],
      dispatcher: 'claude-agent-sdk',
    },
    connection: { type: '—', location: '—', via: 'browser', tablesSynced: 0, lastSync: '—', health: 'healthy' },
    components: [{
      id: purpose,
      name: componentName,
      componentType: 'analytical',
      realizationKind: 'skill',
      trigger: 'one_shot',
      outcome: 'none',
      callableAs: purpose,
      model: available ? 'claude-sonnet' : '—',
      tiers: available ? [{ tier: 'strong', model: 'claude-sonnet' }] : [],
      capabilities: [],
      guardrails: [],
      tools: [],
      outputBlocks: [],
      steps: [],
      status: available ? 'ready' : 'unavailable',
      ...(!available ? { unavailableReason: reason } : {}),
    }],
    nativeSessions: { binding: { configured: true, generation: 1, targetLabel: 'Claude CLI' }, dispatches: [] },
  };
}

test('Harness keeps every Setup, Analyze, and Context readiness state contained at a compact viewport', async ({ page }) => {
  let current = CASES[0]!;
  await page.setViewportSize({ width: 360, height: 760 });
  await page.route('**/api/harness?*', async (route) => {
    const requested = new URL(route.request().url()).searchParams.get('purpose') as Purpose;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(harnessResponse(requested, requested === current.purpose ? current.available : true)),
    });
  });

  for (const scenario of CASES) {
    current = scenario;
    await test.step(`${scenario.purpose} is ${scenario.available ? 'ready' : 'unavailable'}`, async () => {
      await page.goto('/harness');
      if (scenario.purpose !== 'analysis') {
        await page.getByRole('navigation', { name: 'Profiles' }).getByRole('button', {
          name: scenario.purpose === 'setup' ? /Setup/ : /Context enrichment/,
        }).click();
      }

      const executionPath = page.getByLabel('Execution path');
      await expect(executionPath.getByText(scenario.purpose, { exact: true })).toBeVisible();
      await expect(executionPath.getByText('vercel:headless', { exact: true })).toBeVisible();
      await expect(executionPath.getByText('Claude CLI', { exact: true })).toBeVisible();
      await expect(executionPath.getByText(scenario.available ? 'Ready' : 'Unavailable', { exact: true })).toBeVisible();

      const componentRow = page.getByRole('row').filter({ hasText: componentFor(scenario.purpose) });
      await expect(componentRow).toBeVisible();
      if (scenario.available) {
        await expect(componentRow.getByText('Available', { exact: true })).toBeVisible();
        await expect(componentRow.getByRole('button')).toHaveCount(1);
      } else {
        const reason = `Native ${scenario.purpose.replace('_', ' ')} is unavailable.`;
        await expect(componentRow.getByText(`Unavailable: ${reason}`, { exact: true })).toBeVisible();
        await expect(componentRow.getByRole('button')).toHaveCount(0);
      }
    });
  }

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByTestId('contextual-sidebar')).toHaveClass(/ant-layout-sider-collapsed/);
  const content = page.getByTestId('app-content');
  await expect.poll(() => content.evaluate((element) => element.clientWidth)).toBeGreaterThan(300);
  const bounds = await content.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
});
