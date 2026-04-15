import { Page, expect } from '@playwright/test';

type OnboardingPageContext = {
  page: Page;
};

export const setupModels = async ({ page }: OnboardingPageContext) => {
  await page.goto('/setup/models');

  // select all models
  await page.locator('th').first().click();

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL('/setup/relationships', { timeout: 60000 });
};

export const saveRecommendedRelationships = async ({
  page,
}: OnboardingPageContext) => {
  await page.goto('/setup/relationships');

  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL('/modeling', { timeout: 60000 });
};
