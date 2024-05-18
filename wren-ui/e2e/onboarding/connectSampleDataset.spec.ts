import { test, expect } from '@playwright/test';
import * as helper from '../helper';

test.afterEach(async () => {
  await helper.resetDatabase();
});

test('test E-commerce dataset successfully.', async ({ page }) => {
  await page.goto('/setup/connection');
  await page.getByRole('button', { name: 'E-commerce' }).click();
  await page.waitForURL('/home');
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
