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

  test('Select HR dataset and check suggested questions', async ({ page }) => {
    await page.goto('/setup/connection');
    await page.getByRole('button', { name: 'HR' }).click();
    await expect(page).toHaveURL('/home', { timeout: 60000 });
    for (const suggestedQuestion of suggestedQuestions) {
      await expect(page.getByText(suggestedQuestion.question)).toBeVisible();
    }
  });

  test('Ask first suggested question', async ({ page, baseURL }) => {
    await homeHelper.askSuggestionQuestionTest({
      page,
      baseURL,
      suggestedQuestion: suggestedQuestions[1].question,
    });
  });

  test(
    'Check deploy status should be in Synced status',
    modelingHelper.checkDeploySynced,
  );
});
