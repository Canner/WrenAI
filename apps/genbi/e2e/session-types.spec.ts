import { expect, test } from '@playwright/test';

async function expectNoHorizontalOverflow(locator: import('@playwright/test').Locator) {
  const bounds = await locator.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
}

test('New session separates Structured Ask from Native Analyze', async ({ page }) => {
  await page.goto('/sessions');
  await page.getByRole('button', { name: /new session/i }).click();

  await expect(page.getByRole('region', { name: 'Structured Ask session', exact: true })).toContainText('Chart-first answers, dashboards, and follow-up questions.');
  await expect(page.getByRole('region', { name: 'Native terminal session' })).toContainText('Open a running terminal or start a separate CLI session for analysis or context enrichment.');
  await expect(page.getByRole('radio', { name: 'Analyze data' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Set up a project' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Start Structured Ask' }).click();
  await expect(page).toHaveURL(/\/sessions\/ask\//);
  await expect(page.getByText('Ask anything about your data')).toBeVisible();

  await page.goto('/sessions');
  await expect(page.getByRole('navigation', { name: 'Sessions' }).getByText('New Structured Ask')).toBeVisible();
  await page.getByRole('button', { name: /new session/i }).click();
  await page.getByRole('radio', { name: 'Analyze data' }).check();
  await page.getByRole('button', { name: 'Start separate native terminal' }).click();
  await expect(page).toHaveURL(/\/sessions\/browser-analysis$/);
  await expect(page.getByText('Session exited')).toBeVisible();
});

test('New session choices stay contained at a compact dark viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await page.addInitScript(() => {
    localStorage.setItem('wren-genbi-ui', JSON.stringify({ state: { themeMode: 'dark', sidebarCollapsed: false }, version: 0 }));
  });
  await page.goto('/sessions');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: /new session/i }).click();

  const menu = page.getByLabel('New session options');
  await expect(menu).toBeVisible();
  await page.getByRole('radio', { name: 'Enrich context' }).check();
  const existing = page.getByRole('button', { name: 'Open existing Enrich context session 08107e3e' });
  await expect(existing).toBeVisible();
  await expect(existing).toHaveAttribute('title', 'Open existing Enrich context session 08107e3e');
  await existing.focus();
  await expect(existing).toBeFocused();

  const bounds = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
  });
  // rc-trigger includes its one-pixel shadow edge in this rect at the viewport boundary.
  expect(bounds.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.right).toBeLessThanOrEqual(360);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
});

test('artifact and session sidebars retain long English and CJK labels at desktop and compact widths', async ({ page }) => {
  const longEnglish = 'Quarterly revenue retention analysis for enterprise expansion opportunities across every regional sales team';
  const longCjk = '跨區域客戶留存與產品採用趨勢分析報告，協助辨識下一季的成長機會';

  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto('/artifacts');
  const artifactSidebar = page.getByRole('navigation', { name: 'Artifacts' });
  await expect(artifactSidebar.getByText(longEnglish)).toBeVisible();
  await expect(artifactSidebar.getByText(longCjk)).toBeVisible();
  await expect(artifactSidebar.getByRole('button', { name: new RegExp(longEnglish) })).toHaveAttribute('aria-current', 'true');
  await expect(artifactSidebar.getByRole('button')).toHaveCount(10);
  const cjkArtifactRow = artifactSidebar.getByRole('button', { name: new RegExp(longCjk) });
  await cjkArtifactRow.focus();
  await expect(cjkArtifactRow).toBeFocused();
  await expectNoHorizontalOverflow(artifactSidebar);

  await page.setViewportSize({ width: 360, height: 760 });
  await expect(artifactSidebar.getByText(longEnglish)).toBeVisible();
  await expect(artifactSidebar.getByText(longCjk)).toBeVisible();
  await expectNoHorizontalOverflow(artifactSidebar);

  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto('/sessions/native-session-8b7e2a19');
  const sessionsSidebar = page.getByRole('navigation', { name: 'Sessions' });
  await expect(sessionsSidebar.getByText(longEnglish)).toBeVisible();
  await expect(sessionsSidebar.getByText(longCjk)).toBeVisible();
  const nativeRow = sessionsSidebar.getByRole('button', { name: /Analyze data.*8b7e2a19.*Native terminal.*Claude.*Running/ });
  await expect(nativeRow).toHaveAttribute('aria-current', 'page');
  await nativeRow.focus();
  await expect(nativeRow).toBeFocused();
  expect(await sessionsSidebar.getByRole('button').count()).toBeGreaterThanOrEqual(7);
  await expectNoHorizontalOverflow(sessionsSidebar);

  await page.setViewportSize({ width: 360, height: 760 });
  await expect(sessionsSidebar.getByText(longCjk)).toBeVisible();
  await expectNoHorizontalOverflow(sessionsSidebar);
});
