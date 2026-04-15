import { test, expect } from '@playwright/test';
import * as helper from '../helper';
import * as homeHelper from '../commonTests/home';
import * as modelingHelper from '../commonTests/modeling';
import { sampleDatasets } from '@/apollo/server/data';

const suggestedQuestions = sampleDatasets.hr.questions ?? [];

const getRequiredSuggestedQuestion = (index: number) => {
  const suggestedQuestion = suggestedQuestions[index]?.question;
  if (!suggestedQuestion) {
    throw new Error(`Missing suggested question at index ${index}`);
  }

  return suggestedQuestion;
};

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

  test('Use suggestion question', async ({ page }) => {
    // select first suggested question
    await homeHelper.askSuggestionQuestionTest({
      page,
      suggestedQuestion: getRequiredSuggestedQuestion(1),
    });
  });

  test(
    'Check deploy status should be in Synced status',
    modelingHelper.checkDeploySynced,
  );
});
