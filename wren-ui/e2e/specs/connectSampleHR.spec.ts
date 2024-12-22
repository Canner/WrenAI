import { test, expect } from '@playwright/test';
import * as helper from '../helper';
import * as homeHelper from '../commonTests/home';
import * as modelingHelper from '../commonTests/modeling';
import { sampleDatasets } from '@/apollo/server/data';

const suggestedQuestions = sampleDatasets.hr.questions;

test.describe('Test HR sample dataset', () => {
  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('Starting HR dataset successfully', async ({ page }) => {
    await page.goto('/setup/connection');
    await page.getByRole('button', { name: 'Human Resource' }).click();
    await expect(page).toHaveURL('/modeling', { timeout: 60000 });
  });

  test('Check suggested questions', async ({ page }) => {
    await page.goto('/home');
    for (const suggestedQuestion of suggestedQuestions) {
      await expect(page.getByText(suggestedQuestion.question)).toBeVisible();
    }
  });

  test('Use suggestion question', async ({ page, baseURL }) => {
    // select first suggested question
    await homeHelper.askSuggestionQuestionTest({
      page,
      suggestedQuestion: suggestedQuestions[1].question,
    });
  });

  test(
    'Check deploy status should be in Synced status',
    modelingHelper.checkDeploySynced,
  );
});
