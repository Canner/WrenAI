import { test, expect } from '@playwright/test';
import * as helper from '../helper';

test.describe('Test NBA sample dataset', () => {
  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('Starting NBA dataset successfully', async ({ page }) => {
    await page.goto('/setup/connection');
    await page.getByRole('button', { name: 'NBA' }).click();
    await expect(page).toHaveURL('/home', { timeout: 60000 });
    await expect(
      page.getByText(
        'How many three-pointers were made by each player in each game?',
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        'What is the differences in turnover rates between teams with high and low average scores?',
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Which teams had the highest average points scored per game throughout the season?',
      ),
    ).toBeVisible();
  });
});
