import { Page, expect } from '@playwright/test';
import { expectPathname } from '../helper';

type OnboardingPageContext = {
  page: Page;
};

export const setupModels = async ({ page }: OnboardingPageContext) => {
  await page.goto('/setup/models');

  // select all models
  await page.locator('th').first().click();

  await page.getByRole('button', { name: 'Next' }).click();
  await expectPathname({ page, pathname: '/setup/relationships' });
};

export const saveRecommendedRelationships = async ({
  page,
}: OnboardingPageContext) => {
  await page.goto('/setup/relationships');

  await page.getByRole('button', { name: 'Finish' }).click();
  await expectPathname({ page, pathname: '/knowledge' });
  await expect(page).toHaveURL(/\/knowledge(?:\?.*section=modeling.*)?$/);
};
