import { test, expect } from '@playwright/test';
import { getTestConfig } from '../config';
import * as helper from '../helper';
import * as onboarding from '../commonTests/onboarding';

const testConfig = getTestConfig();

test.describe('Test MySQL data source', () => {
  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('Connect MySQL data source successfully', async ({ page }) => {
    await page.goto('/setup/connection');

    await page.locator('button').filter({ hasText: 'MySQL' }).click();

    await page.getByLabel('Display name').click();
    await page.getByLabel('Display name').fill('test-mysql');
    await page.getByLabel('Host').click();
    await page.getByLabel('Host').fill(testConfig.mysql.host);
    await page.getByLabel('Port').click();
    await page.getByLabel('Port').fill(testConfig.mysql.port);
    await page.getByLabel('Username').click();
    await page.getByLabel('Username').fill(testConfig.mysql.username);
    await page.getByLabel('Password').click();
    await page.getByLabel('Password').fill(testConfig.mysql.password);
    await page.getByLabel('Database name').click();
    await page.getByLabel('Database name').fill(testConfig.mysql.database);

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL('/setup/models', { timeout: 60000 });
  });

  test('Setup all models', onboarding.setupModels);

  test(
    'Save recommended relationships',
    onboarding.saveRecommendedRelationships,
  );
});
