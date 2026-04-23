import { test, expect, Page } from '@playwright/test';
import * as helper from '../helper';
import { SampleDatasetName } from '@/types/dataSource';

const OPENING_QUESTION = 'What is the average salary for each title?';
const RECOMMENDATION_TRIGGER_QUESTION = '推荐几个问题给我';
const SEND_BUTTON_NAME = /发送问题|Send/i;
const RECOMMENDATION_TRIGGER_BUTTON_NAME =
  /推荐几个问题给我|Recommend|Suggest/i;
const RECOMMENDATION_SECTION_NAME = /推荐追问|Recommended/i;
const SQL_TAB_NAME = /SQL Query|SQL 查询/;

const getPromptInput = (page: Page) =>
  page
    .getByRole('textbox', {
      name: /输入问题，@ 指定知识库|继续追问以深入分析你的数据/,
    })
    .first();

const getResponseCards = (page: Page) => page.locator('[data-jsid="answerResult"]');

const waitForGenerateRecommendationRequest = (page: Page) =>
  page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        response.request().method() === 'POST' &&
        /\/api\/v1\/thread-responses\/\d+\/generate-recommendations$/.test(
          url.pathname,
        )
      );
    },
    { timeout: 120_000 },
  );

const waitForRecommendationItems = async (page: Page, responseCardIndex: number) => {
  const responseCard = getResponseCards(page).nth(responseCardIndex);
  const getFilteredButtonTexts = async () => {
    const buttonTexts = (await responseCard.locator('button').allTextContents()).map(
      (text) => text.trim(),
    );

    return buttonTexts.filter(
      (text) =>
        Boolean(text) &&
        text !== '重试生成推荐问题' &&
        text !== 'Retry generating recommendations' &&
        text !== RECOMMENDATION_TRIGGER_QUESTION,
    );
  };

  await expect(responseCard.getByText(RECOMMENDATION_SECTION_NAME)).toBeVisible({
    timeout: 120_000,
  });

  await expect
    .poll(async () => (await getFilteredButtonTexts()).length, {
      timeout: 120_000,
    })
    .toBeGreaterThanOrEqual(2);

  return getFilteredButtonTexts();
};

test.describe('Home recommendation follow-up alignment', () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(async () => {
    await helper.resetDatabase();
  });

  test('keeps recommendation trigger and recommendation items draft-first while persisting response-scoped results', async ({
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

    const promptInput = getPromptInput(page);
    const responseCards = getResponseCards(page);

    await promptInput.fill(OPENING_QUESTION);
    await page.getByRole('button', { name: SEND_BUTTON_NAME }).click();

    await expect(responseCards).toHaveCount(1, { timeout: 120_000 });
    await expect(
      responseCards.first().getByRole('heading', { name: OPENING_QUESTION }),
    ).toBeVisible({ timeout: 120_000 });
    await expect(
      responseCards.first().getByRole('button', {
        name: RECOMMENDATION_TRIGGER_BUTTON_NAME,
      }),
    ).toBeVisible({ timeout: 120_000 });

    await expect(page.getByTestId('thread-workbench')).toBeVisible({
      timeout: 120_000,
    });
    await page
      .getByTestId('thread-workbench')
      .locator('.ant-segmented-item')
      .filter({ hasText: SQL_TAB_NAME })
      .click();
    await expect(
      page
        .getByTestId('thread-workbench')
        .locator('.ant-segmented-item-selected')
        .filter({ hasText: SQL_TAB_NAME }),
    ).toBeVisible({ timeout: 30_000 });

    const recommendationRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (
        request.method() === 'POST' &&
        /\/api\/v1\/thread-responses\/\d+\/generate-recommendations$/.test(
          url.pathname,
        )
      ) {
        recommendationRequests.push(url.pathname);
      }
    });

    await responseCards
      .first()
      .getByRole('button', {
        name: RECOMMENDATION_TRIGGER_BUTTON_NAME,
      })
      .click();

    await expect(promptInput).toHaveValue(RECOMMENDATION_TRIGGER_QUESTION);
    await page.waitForTimeout(500);
    expect(recommendationRequests).toHaveLength(0);

    const recommendationRequest = waitForGenerateRecommendationRequest(page);
    await page.getByRole('button', { name: SEND_BUTTON_NAME }).click();
    await recommendationRequest;

    await expect(responseCards).toHaveCount(2, { timeout: 120_000 });
    const recommendationCard = responseCards.nth(1);
    await expect(
      recommendationCard.getByRole('heading', {
        name: /推荐几个问题给我|Recommend/i,
      }),
    ).toBeVisible({ timeout: 120_000 });

    const recommendationItems = await waitForRecommendationItems(page, 1);
    const firstRecommendedQuestion = recommendationItems[0];
    expect(firstRecommendedQuestion).toBeTruthy();

    await expect(page.getByTestId('thread-workbench')).toBeVisible();
    await expect(
      page
        .getByTestId('thread-workbench')
        .locator('.ant-segmented-item-selected')
        .filter({ hasText: SQL_TAB_NAME }),
    ).toBeVisible();

    const followUpCreateRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (
        request.method() === 'POST' &&
        /\/api\/v1\/threads\/\d+\/responses$/.test(url.pathname)
      ) {
        followUpCreateRequests.push(url.pathname);
      }
    });

    await recommendationCard.getByRole('button', { name: firstRecommendedQuestion }).click();
    await expect(promptInput).toHaveValue(firstRecommendedQuestion);
    await page.waitForTimeout(500);
    expect(followUpCreateRequests).toHaveLength(0);
    await expect(responseCards).toHaveCount(2);

    await page.getByRole('button', { name: SEND_BUTTON_NAME }).click();

    await expect(responseCards).toHaveCount(3, { timeout: 120_000 });
    await expect(
      responseCards.last().getByRole('heading', { name: firstRecommendedQuestion }),
    ).toBeVisible({ timeout: 120_000 });

    const threadUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(threadUrl);
    await expect(responseCards).toHaveCount(3, { timeout: 120_000 });
    await expect(
      responseCards.nth(1).getByText(RECOMMENDATION_SECTION_NAME),
    ).toBeVisible({ timeout: 120_000 });
    await expect(
      responseCards.last().getByRole('heading', { name: firstRecommendedQuestion }),
    ).toBeVisible({ timeout: 120_000 });
  });
});
