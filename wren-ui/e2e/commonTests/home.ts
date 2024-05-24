import { Page, expect } from '@playwright/test';
import {
  AskingTask,
  AskingTaskStatus,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';

export const checkAskingProcess = async (page: Page, question: string) => {
  // check process state
  await expect(page.getByText('Searching data')).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(page.getByPlaceholder('Ask to explore your data')).toHaveValue(
    question,
  );
  await expect(page.getByRole('button', { name: 'Ask' })).toBeDisabled();
};

export const waitingForAskingTask = async (page: Page, baseURL) => {
  await page.waitForResponse(
    async (response) => {
      const responseBody = await response.json();
      const responseData: AskingTask = responseBody?.data?.askingTask;
      return (
        response.url() === `${baseURL}/api/graphql` &&
        response.status() === 200 &&
        responseBody &&
        [AskingTaskStatus.FAILED, AskingTaskStatus.FINISHED].includes(
          responseData?.status,
        )
      );
    },
    { timeout: 100000 },
  );
};

export const checkCandidatesResult = async (page: Page) => {
  await expect(
    page.locator('div').filter({ hasText: 'result(s) found' }).last(),
  ).toBeVisible();
  await expect(page.getByText('result(s) found')).toBeVisible();
};

export const getFirstCandidatesResultSummary = async (page: Page) => {
  const candidatesResultHandle = await page.evaluateHandle(
    (document) => {
      const nodes: any = Array.from(
        document.querySelectorAll('div[role="row"]'),
      );
      const node = nodes[nodes.length - 1];
      const firstResult = node.firstElementChild.lastElementChild;

      return firstResult.childNodes[1].innerText;
    },
    await page.evaluateHandle(() => document),
  );

  const firstResultSummary = await candidatesResultHandle.jsonValue();
  await candidatesResultHandle.dispose();

  return firstResultSummary;
};

export const checkSkeletonLoading = async (page: Page, isShow: boolean) => {
  await expect(page.locator('.ant-skeleton-content')).toBeVisible({
    visible: isShow,
  });
};

export const waitingForThreadResponse = async (page: Page, baseURL: string) => {
  await page.waitForResponse(
    async (response) => {
      const responseBody = await response.json();
      const responseData: ThreadResponse = responseBody?.data?.threadResponse;
      return (
        response.url() === `${baseURL}/api/graphql` &&
        response.status() === 200 &&
        responseBody &&
        [AskingTaskStatus.FAILED, AskingTaskStatus.FINISHED].includes(
          responseData?.status,
        )
      );
    },
    { timeout: 100000 },
  );
};

export const askSuggestionQuestionTest = async ({
  page,
  baseURL,
  suggestedQuestion,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL('/home', { timeout: 60000 });

  await page.getByText(suggestedQuestion).click();

  // check asking process state and wait for asking task to finish
  await checkAskingProcess(page, suggestedQuestion);
  await waitingForAskingTask(page, baseURL);
  await checkCandidatesResult(page);

  const firstResult = await getFirstCandidatesResultSummary(page);
  await page.getByRole('cell', { name: firstResult }).first().click();

  await checkSkeletonLoading(page, true);
  await waitingForThreadResponse(page, baseURL);
  await checkSkeletonLoading(page, false);

  // check question block
  await expect(page.getByLabel('question-circle').locator('svg')).toBeVisible();
  await expect(page.getByText('Question:')).toBeVisible();
  await expect(page.getByText(suggestedQuestion)).toBeVisible();

  // check thread summary
  await expect(page.getByRole('heading', { name: firstResult })).toBeVisible();

  // check show preview data table as default open
  await expect(page.locator('.ant-table')).toBeVisible();
  await expect(page.getByText('Showing up to 500 rows')).toBeVisible();

  // check up-circle icon with Collapse button
  await expect(page.getByLabel('up-circle').locator('svg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse' })).toBeVisible();

  // click View Full SQL button
  await page.getByRole('button', { name: 'View Full SQL' }).click();
  await expect(page.locator('.ace_editor')).toBeVisible();

  // check collapse and copy button
  await expect(page.getByLabel('up-circle').locator('svg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse' })).toBeVisible();
  await expect(page.getByLabel('copy').locator('svg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();

  // check save icon button
  await expect(page.getByLabel('save').locator('svg')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save as View' }),
  ).toBeVisible();
};

export const followUpQuestionTest = async ({ page, baseURL, question }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/home', { timeout: 60000 });

  // click existing thread
  await page
    .getByRole('tree')
    .locator('div')
    .filter({ hasText: /\W/ })
    .nth(2)
    .click();

  // ask follow up question
  await page.getByPlaceholder('Ask to explore your data').fill(question);
  await page.getByRole('button', { name: 'Ask' }).click();

  // check asking process state and wait for asking task to finish
  await checkAskingProcess(page, question);
  await waitingForAskingTask(page, baseURL);
  await checkCandidatesResult(page);

  // click the View SQL
  await page
    .getByRole('cell', { name: 'Result 1 function View SQL' })
    .getByRole('button')
    .click();
  await page.getByLabel('Close', { exact: true }).click();

  const firstResult = await getFirstCandidatesResultSummary(page);

  // select the first suggested question if there are two same results
  await page.getByRole('cell', { name: firstResult }).first().click();

  await checkSkeletonLoading(page, true);
  await waitingForThreadResponse(page, baseURL);
  await checkSkeletonLoading(page, false);

  // check question block
  await expect(
    page.getByLabel('question-circle').locator('svg').last(),
  ).toBeVisible();
  await expect(page.getByText('Question:').last()).toBeVisible();
  await expect(page.getByText(question)).toBeVisible();

  // check thread summary
  await expect(page.getByRole('heading', { name: firstResult })).toBeVisible();

  await expect(page.locator('.ant-table').last()).toBeVisible();
  await expect(page.getByText('Showing up to 500 rows').last()).toBeVisible();

  // check up-circle icon with Collapse button
  await expect(
    page.getByLabel('up-circle').locator('svg').last(),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Collapse' }).last(),
  ).toBeVisible();

  // click View Full SQL button
  await page.getByRole('button', { name: 'View Full SQL' }).last().click();

  await expect(page.locator('.ace_editor')).toBeVisible();

  // check collapse and copy button
  await expect(
    page.getByLabel('up-circle').locator('svg').last(),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Collapse' }).last(),
  ).toBeVisible();
  await expect(page.getByLabel('copy').locator('svg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();

  // check save icon button
  await expect(page.getByLabel('save').locator('svg').last()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save as View' }).last(),
  ).toBeVisible();
};
