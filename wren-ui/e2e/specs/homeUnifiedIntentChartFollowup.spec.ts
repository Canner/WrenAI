import { test, expect, Page } from '@playwright/test';
import * as helper from '../helper';
import { SampleDatasetName } from '@/types/dataSource';

const OPENING_QUESTION = 'What is the average salary for each title?';
const CHART_FOLLOW_UP_QUESTION = '生成一张图表给我';
const SEND_BUTTON_NAME = '发送问题';
const GENERATE_CHART_BUTTON_NAME = /生成一张图表给我|生成图表|Generate chart/;
const PREVIEW_TAB_NAME = /Data Preview|数据预览/;
const SQL_TAB_NAME = /SQL Query|SQL 查询/;
const CHART_TAB_NAME = /Chart|图表/;
const CLOSE_WORKBENCH_BUTTON_NAME = /关闭结果区|Close workbench/;
const COPY_SQL_BUTTON_NAME = /复制 SQL|Copy SQL/;
const ADJUST_SQL_BUTTON_NAME = /调整 SQL|Adjust SQL/;
const RECOMMENDED_QUESTIONS_BUTTON_NAME = /推荐几个问题给我|Recommend|Suggest/i;

const getPromptInput = (page: Page) =>
  page
    .getByRole('textbox', {
      name: /输入问题，@ 指定知识库|继续追问以深入分析你的数据/,
    })
    .first();

const waitForChartRequest = (page: Page) =>
  page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        response.request().method() === 'POST' &&
        /\/api\/v1\/thread-responses\/\d+\/generate-chart$/.test(url.pathname)
      );
    },
    { timeout: 30_000 },
  );

const waitForChartSurface = async (page: Page) => {
  const chartSurface = page.locator('.adm-chart svg, .adm-chart canvas').first();
  const chartErrorAlert = page.getByRole('alert').filter({
    hasText: /图表生成失败|Chart not available|The chart couldn't be generated/,
  });

  const timeoutAt = Date.now() + 120_000;
  while (Date.now() < timeoutAt) {
    const [hasChart, hasError] = await Promise.all([
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

    if (hasError) {
      throw new Error('Chart follow-up rendered an error instead of a chart');
    }

    await page.waitForTimeout(500);
  }

  throw new Error('Timed out waiting for the chart workbench to render');
};

const getWorkbenchSegmentedItem = (page: Page, name: RegExp) =>
  page
    .getByTestId('thread-workbench')
    .locator('.ant-segmented-item')
    .filter({ hasText: name });

const expectWorkbenchSegmentedSelected = async (
  page: Page,
  name: RegExp,
) => {
  await expect(
    page
      .getByTestId('thread-workbench')
      .locator('.ant-segmented-item-selected')
      .filter({ hasText: name }),
  ).toBeVisible();
};

test.describe('Home unified intent + chart follow-up workbench', () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async () => {
    await helper.resetDatabase();
  });

  test('keeps ask flow working and routes chart-only follow-up into a chart response + workbench', async ({
    page,
  }) => {
    const selector = await helper.ensureSystemSampleRuntimeScope({
      page,
      sampleDataset: SampleDatasetName.HR,
    });

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/home',
      selector,
    });
    await helper.expectPathname({ page, pathname: '/home' });

    await expect(page.getByTestId('thread-workbench')).toHaveCount(0);

    await getPromptInput(page).fill(OPENING_QUESTION);
    await page.getByRole('button', { name: SEND_BUTTON_NAME }).click();

    const responseCards = page.locator('[data-jsid="answerResult"]');
    await expect(responseCards).toHaveCount(1, { timeout: 120_000 });
    await expect(
      page.getByRole('heading', { name: OPENING_QUESTION }),
    ).toBeVisible({ timeout: 120_000 });
    await expect(
      responseCards.first().getByRole('button', {
        name: GENERATE_CHART_BUTTON_NAME,
      }),
    ).toBeVisible({ timeout: 120_000 });
    await expect(
      responseCards.first().getByRole('button', {
        name: RECOMMENDED_QUESTIONS_BUTTON_NAME,
      }),
    ).toBeVisible({ timeout: 120_000 });

    await expect(page.getByTestId('thread-workbench')).toBeVisible({
      timeout: 120_000,
    });
    await expect(
      getWorkbenchSegmentedItem(page, PREVIEW_TAB_NAME),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId('thread-workbench').getByRole('button', {
        name: CLOSE_WORKBENCH_BUTTON_NAME,
      }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      getWorkbenchSegmentedItem(page, SQL_TAB_NAME),
    ).toBeVisible({ timeout: 30_000 });
    await getWorkbenchSegmentedItem(page, SQL_TAB_NAME).click();
    await expect(
      page.getByTestId('thread-workbench').getByRole('button', {
        name: COPY_SQL_BUTTON_NAME,
      }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId('thread-workbench').getByRole('button', {
        name: ADJUST_SQL_BUTTON_NAME,
      }),
    ).toBeVisible({ timeout: 30_000 });
    await expectWorkbenchSegmentedSelected(page, SQL_TAB_NAME);

    await page.reload();
    await expect(
      responseCards.first().getByRole('heading', { name: OPENING_QUESTION }),
    ).toBeVisible({ timeout: 120_000 });
    await expect(
      responseCards.first().getByRole('button', {
        name: RECOMMENDED_QUESTIONS_BUTTON_NAME,
      }),
    ).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('thread-workbench')).toBeVisible({
      timeout: 120_000,
    });
    await expectWorkbenchSegmentedSelected(page, SQL_TAB_NAME);
    await expect(
      page.getByTestId('thread-workbench').getByRole('button', {
        name: COPY_SQL_BUTTON_NAME,
      }),
    ).toBeVisible({ timeout: 30_000 });

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

    await expect(page.getByTestId('thread-workbench')).toBeVisible({
      timeout: 120_000,
    });
    await expect(
      getWorkbenchSegmentedItem(page, CHART_TAB_NAME),
    ).toBeVisible({ timeout: 120_000 });
    await expectWorkbenchSegmentedSelected(page, CHART_TAB_NAME);
    await waitForChartSurface(page);
  });
});
