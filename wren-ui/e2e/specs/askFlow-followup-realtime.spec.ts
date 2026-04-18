import { test, expect } from '@playwright/test';
import * as helper from '../helper';
import * as homeHelper from '../commonTests/home';
import { SampleDatasetName } from '@/types/dataSource';

const OPENING_QUESTION = '统计最近30天订单量趋势';
const FOLLOW_UP_QUESTION = '只看最近7天，并按天给我趋势';
const FOLLOW_UP_PLACEHOLDER = '继续追问以深入分析你的数据';
const SEND_BUTTON_NAME = '发送问题';

test.describe('Follow-up ask realtime regression', () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async () => {
    await helper.resetDatabase();
  });

  test('keeps the follow-up in the current thread and renders it before the response record persists', async ({
    page,
  }) => {
    const selector = await helper.ensureSystemSampleRuntimeScope({
      page,
      sampleDataset: SampleDatasetName.ECOMMERCE,
    });

    await homeHelper.askQuestionTest({
      page,
      question: OPENING_QUESTION,
      selector,
    });

    const threadUrl = page.url();
    const responseCards = page.locator('[data-jsid="answerResult"]');
    await expect(responseCards).toHaveCount(1);

    let createResponseCompletedAt: number | null = null;
    page.on('response', async (response) => {
      if (
        response.request().method() === 'POST' &&
        /\/api\/v1\/threads\/\d+\/responses/.test(response.url())
      ) {
        createResponseCompletedAt = Date.now();
      }
    });

    await page
      .getByRole('textbox', { name: FOLLOW_UP_PLACEHOLDER })
      .fill(FOLLOW_UP_QUESTION);
    await page.getByRole('button', { name: SEND_BUTTON_NAME }).click();

    let optimisticRenderAt: number | null = null;
    await expect
      .poll(
        async () => {
          const count = await responseCards.count();
          if (count >= 2 && optimisticRenderAt === null) {
            optimisticRenderAt = Date.now();
          }
          return count;
        },
        { timeout: 5_000 },
      )
      .toBe(2);

    const lastResponseCard = responseCards.last();
    await expect(
      lastResponseCard.getByRole('heading', { name: FOLLOW_UP_QUESTION }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(lastResponseCard.getByText('回答准备步骤')).toBeVisible({
      timeout: 5_000,
    });

    await expect
      .poll(() => Boolean(createResponseCompletedAt), {
        timeout: 120_000,
      })
      .toBe(true);

    expect(optimisticRenderAt).not.toBeNull();
    expect(createResponseCompletedAt).not.toBeNull();
    expect(optimisticRenderAt!).toBeLessThanOrEqual(
      (createResponseCompletedAt || 0) + 250,
    );

    await expect(
      lastResponseCard.getByRole('tab', { name: /SQL 查询/ }),
    ).toBeVisible({ timeout: 120_000 });
    await expect(
      lastResponseCard.getByRole('button', { name: '保存为视图' }),
    ).toBeVisible({ timeout: 120_000 });
    await expect(page).toHaveURL(threadUrl);
  });
});
