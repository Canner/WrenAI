import { test, expect, Page } from '@playwright/test';
import * as helper from '../helper';
import { SampleDatasetName } from '@/types/dataSource';
import { resolveDashboardDisplayName } from '@/utils/dashboardRest';

const OPENING_QUESTION =
  'What is the total value of payments made by customers from each state?';
const CHART_FOLLOW_UP_QUESTION = '生成一张图表给我';
const SEND_BUTTON_NAME = '发送问题';
const GENERATE_CHART_BUTTON_NAME = /生成一张图表给我|生成图表|Generate chart/;

const getPromptInput = (page: Page) =>
  page
    .getByRole('textbox', {
      name: /输入问题，@ 指定知识库|继续追问以深入分析你的数据/,
    })
    .first();

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

const waitForChartSurface = async (page: Page) => {
  const chartSurface = page
    .locator('.adm-chart svg, .adm-chart canvas')
    .first();
  const chartErrorAlert = page.getByRole('alert').filter({
    hasText:
      /图表生成失败|Chart not available|The chart couldn't be generated|图表数据加载失败|Internal server error/,
  });
  const timeoutAt = Date.now() + 120_000;

  while (Date.now() < timeoutAt) {
    const [hasChart, hasChartError] = await Promise.all([
      chartSurface
        .isVisible()
        .then(Boolean)
        .catch(() => false),
      chartErrorAlert
        .first()
        .isVisible()
        .then(Boolean)
        .catch(() => false),
    ]);

    if (hasChart) {
      return;
    }

    if (hasChartError) {
      throw new Error('Chart render failed instead of showing a chart');
    }

    await page.waitForTimeout(500);
  }

  throw new Error('Timed out waiting for chart rendering result');
};

const ensureDashboardWorkbenchLoaded = async (page: Page) => {
  const createDashboardButton = page
    .getByRole('button', { name: '新建看板' })
    .first();

  if (!(await createDashboardButton.isVisible().catch(() => false))) {
    const dashboardNavItem = page
      .getByRole('menuitem', { name: /数据看板/ })
      .first();
    await expect(dashboardNavItem).toBeVisible({ timeout: 60_000 });
    await dashboardNavItem.click();
    await helper.expectPathname({ page, pathname: '/home/dashboard' });
  }

  await expect(createDashboardButton).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^看板$/)).toBeVisible({ timeout: 60_000 });
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

const getDashboardRailItem = (page: Page, dashboardName: string) =>
  page.getByRole('button', {
    name: new RegExp(resolveDashboardDisplayName(dashboardName)),
  });

const getDashboardRailMoreButton = (page: Page, dashboardName: string) =>
  getDashboardRailItem(page, dashboardName).getByRole('button', {
    name: 'more',
  });

const resolvePinPopover = (page: Page) =>
  page.locator('.ant-popover').filter({ hasText: '新建看板并固定' }).last();

const pinChartToDashboard = async (page: Page, dashboardName: string) => {
  const pinButton = page
    .getByTestId('thread-workbench')
    .getByRole('button', { name: /Pin to dashboard/ })
    .first();
  await expect(pinButton).toBeVisible({ timeout: 60_000 });
  await pinButton.click();
  const successToast = page.getByText(`已固定到看板「${dashboardName}」`);
  const popover = resolvePinPopover(page);
  const timeoutAt = Date.now() + 15_000;

  while (Date.now() < timeoutAt) {
    if (
      await successToast
        .isVisible()
        .then(Boolean)
        .catch(() => false)
    ) {
      return;
    }

    if (
      await popover
        .isVisible()
        .then(Boolean)
        .catch(() => false)
    ) {
      await popover
        .getByRole('button', {
          name: new RegExp(resolveDashboardDisplayName(dashboardName)),
        })
        .click();
      await expect(successToast).toBeVisible({ timeout: 60_000 });
      return;
    }

    await page.waitForTimeout(250);
  }

  throw new Error('Timed out waiting for pin-to-dashboard result');
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
    await createModal
      .getByPlaceholder('例如：经营总览 / 销售日报')
      .fill(dashboardName);
    await createModal.getByRole('button', { name: '创建看板' }).click();

    await expect(page.getByText('已创建看板。')).toBeVisible({
      timeout: 60_000,
    });
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

    await getPromptInput(page).fill(OPENING_QUESTION);
    await page.getByRole('button', { name: SEND_BUTTON_NAME }).click();

    const responseCards = page.locator('[data-jsid="answerResult"]');
    await expect(responseCards).toHaveCount(1, { timeout: 120_000 });
    await expect(
      responseCards.first().getByRole('heading', { name: OPENING_QUESTION }),
    ).toBeVisible({ timeout: 120_000 });
    await expect(
      responseCards
        .first()
        .getByRole('button', { name: GENERATE_CHART_BUTTON_NAME }),
    ).toBeVisible({ timeout: 120_000 });

    const chartRequest = waitForChartRequest(page);
    await getPromptInput(page).fill(CHART_FOLLOW_UP_QUESTION);
    await page.getByRole('button', { name: SEND_BUTTON_NAME }).click();
    await chartRequest;

    await expect(responseCards).toHaveCount(2, { timeout: 120_000 });
    await expect(
      responseCards.last().getByRole('heading', {
        name: CHART_FOLLOW_UP_QUESTION,
      }),
    ).toBeVisible({ timeout: 120_000 });
    await waitForChartSurface(page);

    await pinChartToDashboard(page, dashboardName);

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/home/dashboard',
      selector: {
        ...selector,
        dashboardId: String(dashboardId),
      },
    });
    await helper.expectPathname({ page, pathname: '/home/dashboard' });
    await expect(getDashboardRailItem(page, dashboardName)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-dashboard-item-id]').first()).toBeVisible({
      timeout: 60_000,
    });

    const activeDashboardMoreButton = getDashboardRailMoreButton(
      page,
      dashboardName,
    );
    await expect(activeDashboardMoreButton).toBeVisible({ timeout: 60_000 });

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
    await activeDashboardMoreButton.click();
    await page.getByRole('menuitem', { name: '刷新看板' }).click();
    await refreshRequest;
  });
});
