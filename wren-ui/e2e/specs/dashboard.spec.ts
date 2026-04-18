import { test, expect, Page } from '@playwright/test';
import * as helper from '../helper';
import * as homeHelper from '../commonTests/home';
import { SampleDatasetName } from '@/types/dataSource';

const CHART_QUESTION =
  'What is the total value of payments made by customers from each state?';

const waitForChartRequest = (page: Page) =>
  page
    .waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          response.ok() &&
          response.request().method() === 'POST' &&
          /\/api\/v1\/thread-responses\/\d+\/generate-chart$/.test(url.pathname)
        );
      },
      { timeout: 15_000 },
    )
    .catch(() => null);

const waitForChartState = async (page: Page) => {
  const chartSurface = page.locator('.adm-chart svg, .adm-chart canvas').first();
  const chartError = page.getByRole('alert').filter({
    hasText:
      /The initializing SQL seems to be invalid|Internal server error|图表数据加载失败/,
  });
  const timeoutAt = Date.now() + 120_000;

  while (Date.now() < timeoutAt) {
    const [hasChart, hasChartError] = await Promise.all([
      chartSurface
        .isVisible()
        .then(Boolean)
        .catch(() => false),
      chartError
        .first()
        .isVisible()
        .then(Boolean)
        .catch(() => false),
    ]);

    if (hasChart) {
      return 'chart' as const;
    }

    if (hasChartError) {
      return 'error' as const;
    }

    await page.waitForTimeout(500);
  }

  throw new Error('Timed out waiting for chart rendering result');
};

const openChartTab = async (page: Page) => {
  const chartRequest = waitForChartRequest(page);
  await page.getByRole('tab', { name: /图表/ }).click();
  await chartRequest;
};

const ensureDashboardWorkbenchLoaded = async (page: Page) => {
  const dashboardSearch = page.getByPlaceholder('搜索看板名称');

  if (!(await dashboardSearch.isVisible().catch(() => false))) {
    const dashboardNavItem = page
      .getByRole('menuitem', { name: /数据看板/ })
      .first();
    await expect(dashboardNavItem).toBeVisible({ timeout: 60_000 });
    await dashboardNavItem.click();
    await helper.expectPathname({ page, pathname: '/home/dashboard' });
  }

  await expect(dashboardSearch).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole('button', { name: '新建看板' }).first(),
  ).toBeVisible({ timeout: 60_000 });
};

const openCreateDashboardModal = async (page: Page) => {
  await ensureDashboardWorkbenchLoaded(page);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const createButton = page.getByRole('button', { name: '新建看板' }).first();
    await expect(createButton).toBeVisible({ timeout: 60_000 });

    try {
      await createButton.click({ timeout: 15_000, force: true });
      const createModal = page
        .locator('.ant-modal')
        .filter({ hasText: '新建看板' });
      await expect(createModal).toBeVisible({ timeout: 15_000 });
      return createModal;
    } catch (error) {
      try {
        await createButton.evaluate((node: HTMLElement) => node.click());
        const createModal = page
          .locator('.ant-modal')
          .filter({ hasText: '新建看板' });
        await expect(createModal).toBeVisible({ timeout: 15_000 });
        return createModal;
      } catch {
        // keep retrying below
      }
      if (attempt === 5) {
        throw error;
      }
      await page.waitForTimeout(1_000);
    }
  }

  throw new Error('Unable to open create dashboard modal');
};

const regenerateChart = async (page: Page) => {
  await page.getByRole('button', { name: /^重新生成$/ }).first().click();
  const confirmButton = page
    .getByRole('dialog')
    .getByRole('button', { name: /^重新生成$/ });
  await expect(confirmButton).toBeVisible({ timeout: 15_000 });
  const chartRequest = waitForChartRequest(page);
  await confirmButton.click();
  await chartRequest;
};

const ensureChartRenderedWithRetry = async ({
  page,
  sampleDataset,
}: {
  page: Page;
  sampleDataset: SampleDatasetName;
}) => {
  await helper.ensureSystemSampleRuntimeScope({ page, sampleDataset });
  await openChartTab(page);
  if ((await waitForChartState(page)) === 'chart') {
    return;
  }

  await helper.ensureSystemSampleRuntimeScope({ page, sampleDataset });
  await regenerateChart(page);
  await expect(
    page.locator('.adm-chart svg, .adm-chart canvas').first(),
  ).toBeVisible({ timeout: 120_000 });
};

test.describe('Dashboard flows', () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async () => {
    await helper.resetDatabase();
  });

  test('creates a dashboard, pins a chart result into it, refreshes it, and deletes the item', async ({
    page,
  }) => {
    const dashboardName = `E2E 销售看板 ${Date.now()}`;
    const selector = await helper.ensureSystemSampleRuntimeScope({
      page,
      sampleDataset: SampleDatasetName.ECOMMERCE,
    });

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/home/dashboard',
      selector,
    });
    await helper.expectPathname({ page, pathname: '/home/dashboard' });
    await ensureDashboardWorkbenchLoaded(page);

    const createModal = await openCreateDashboardModal(page);
    await createModal.getByPlaceholder('例如：经营总览 / 销售日报').fill(dashboardName);
    await createModal.getByRole('button', { name: '创建看板' }).click();

    await expect(page.getByText('已创建看板。')).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(() => new URL(page.url()).searchParams.get('dashboardId'))
      .toBeTruthy();
    const dashboardId = new URL(page.url()).searchParams.get('dashboardId');
    expect(dashboardId).toBeTruthy();

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/home',
      selector,
    });
    await helper.expectPathname({ page, pathname: '/home' });

    await homeHelper.askQuestionTest({
      page,
      question: CHART_QUESTION,
      selector,
    });
    await ensureChartRenderedWithRetry({
      page,
      sampleDataset: SampleDatasetName.ECOMMERCE,
    });

    await page.locator('.adm-chart-additional button').last().click();
    const pinModal = page.locator('.ant-modal').filter({ hasText: '固定到看板' });
    await expect(pinModal).toBeVisible({ timeout: 60_000 });
    await pinModal.getByRole('combobox').click();
    await page
      .locator('.ant-select-dropdown')
      .last()
      .locator('.ant-select-item-option')
      .filter({ hasText: dashboardName })
      .click();
    await pinModal.getByRole('button', { name: /固\s*定/ }).click();

    await expect(
      page.getByText(`已固定到看板「${dashboardName}」`),
    ).toBeVisible({ timeout: 60_000 });

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/home/dashboard',
      selector: {
        ...selector,
        dashboardId: String(dashboardId),
      },
    });
    await helper.expectPathname({ page, pathname: '/home/dashboard' });
    await expect(
      page.getByRole('heading', { name: dashboardName }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-dashboard-item-id]').first()).toBeVisible({
      timeout: 60_000,
    });

    const refreshRequest = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          response.ok() &&
          response.request().method() === 'POST' &&
          /\/api\/v1\/dashboard-items\/\d+\/preview$/.test(url.pathname)
        );
      },
      { timeout: 60_000 },
    );
    await page.getByRole('button', { name: '刷新看板' }).click();
    await refreshRequest;

    await page.getByRole('button', { name: '删除当前卡片' }).click();
    await expect(page.getByText('看板项已删除。')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-dashboard-item-id]')).toHaveCount(0);
  });
});
