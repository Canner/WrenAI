import { expect } from '@playwright/test';

export const setupModels = async ({ page }) => {
  await page.goto('/setup/models');

  // select all models
  await page.locator('th').first().click();

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL('/setup/relationships', { timeout: 60000 });
};

export const saveRecommendedRelationships = async ({ page }) => {
  await page.goto('/setup/relationships');

  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL('/modeling', { timeout: 60000 });
};
