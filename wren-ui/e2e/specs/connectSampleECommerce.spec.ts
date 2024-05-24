import { test, expect } from '@playwright/test';
import * as helper from '../helper';
import * as homeHelper from '../commonTests/home';

const suggestedQuestions = [
  'What are the top 3 value for orders placed by customers in each city?',
  'What is the average score of reviews submitted for orders placed by customers in each city?',
  'What is the total value of payments made by customers from each state?',
];

test.describe('Test E-commerce sample dataset', () => {
  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('Starting E-commerce dataset successfully', async ({ page }) => {
    await page.goto('/setup/connection');
    await page.getByRole('button', { name: 'E-commerce' }).click();
    await expect(page).toHaveURL('/home', { timeout: 60000 });

    for (const question of suggestedQuestions) {
      await expect(page.getByText(question)).toBeVisible();
    }
  });

  test('Use suggestion question', async ({ page, baseURL }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/home', { timeout: 60000 });

    // select first suggested question
    const suggestedQuestion = suggestedQuestions[0];
    await page.getByText(suggestedQuestion).click();

    // check asking process state and wait for asking task to finish
    await homeHelper.checkAskingProcess(page, suggestedQuestions[0]);
    await homeHelper.waitingForAskingTask(page, baseURL);
    await homeHelper.checkCandidatesResult(page);

    const firstResult = await homeHelper.getFirstCandidatesResultSummary(page);
    await page.getByRole('cell', { name: firstResult }).first().click();

    await homeHelper.checkSkeletonLoading(page, true);
    await homeHelper.waitingForThreadResponse(page, baseURL);
    await homeHelper.checkSkeletonLoading(page, false);

    // check question block
    await expect(
      page.getByLabel('question-circle').locator('svg'),
    ).toBeVisible();
    await expect(page.getByText('Question:')).toBeVisible();
    await expect(page.getByText(suggestedQuestion)).toBeVisible();

    // check thread summary
    await expect(
      page.getByRole('heading', { name: firstResult }),
    ).toBeVisible();

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
  });

  test('Follow up question', async ({ page, baseURL }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/home', { timeout: 60000 });

    // click existing thread
    await page
      .getByRole('tree')
      .locator('div')
      .filter({ hasText: /\W/ })
      .nth(2)
      .click();

    const question =
      'What are the total sales values for each quarter of each year?';

    // ask follow up question
    await page.getByPlaceholder('Ask to explore your data').fill(question);
    await page.getByRole('button', { name: 'Ask' }).click();

    // check asking process state and wait for asking task to finish
    await homeHelper.checkAskingProcess(page, question);
    await homeHelper.waitingForAskingTask(page, baseURL);
    await homeHelper.checkCandidatesResult(page);

    // click the View SQL
    await page
      .getByRole('cell', { name: 'Result 1 function View SQL' })
      .getByRole('button')
      .click();
    await page.getByLabel('Close', { exact: true }).click();

    const firstResult = await homeHelper.getFirstCandidatesResultSummary(page);
    await page.getByRole('cell', { name: firstResult }).click();

    await homeHelper.checkSkeletonLoading(page, true);
    await homeHelper.waitingForThreadResponse(page, baseURL);
    await homeHelper.checkSkeletonLoading(page, false);

    // check question block
    await expect(
      page.getByLabel('question-circle').locator('svg').last(),
    ).toBeVisible();
    await expect(page.getByText('Question:').last()).toBeVisible();
    await expect(page.getByText(question)).toBeVisible();

    // check thread summary
    await expect(
      page.getByRole('heading', { name: firstResult }),
    ).toBeVisible();

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
  });
});
