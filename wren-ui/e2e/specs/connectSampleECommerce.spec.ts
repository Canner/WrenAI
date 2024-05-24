import { test, expect } from '@playwright/test';
import * as helper from '../helper';

test.describe('Test E-commerce sample dataset', () => {
  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('Starting E-commerce dataset successfully', async ({ page }) => {
    await page.goto('/setup/connection');
    await page.getByRole('button', { name: 'E-commerce' }).click();
    await expect(page).toHaveURL('/home', { timeout: 60000 });
    await expect(
      page.getByText(
        'What are the top 3 value for orders placed by customers in each city?',
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        'What are the top 3 value for orders placed by customers in each city?',
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        'What is the total value of payments made by customers from each state?',
      ),
    ).toBeVisible();
  });
});
