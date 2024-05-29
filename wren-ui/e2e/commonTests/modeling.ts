import { expect } from '@playwright/test';

export const checkDeploySynced = async ({ page }) => {
  await page.goto('/modeling');
  await expect(page).toHaveURL('/modeling', { timeout: 60000 });

  await expect(page.getByLabel('check-circle').locator('svg')).toBeVisible();
  await expect(page.getByText('Synced')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deploy' })).toBeDisabled();
};

export const checkDeployUndeployedChanges = async ({ page }) => {
  await page.goto('/modeling');
  await expect(page).toHaveURL('/modeling', { timeout: 60000 });

  await expect(page.getByLabel('warning').locator('svg')).toBeVisible();
  await expect(page.getByText('Undeployed changes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deploy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deploy' })).toBeEnabled();
};
