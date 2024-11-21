import { test, expect } from '@playwright/test';
import { getTestConfig } from '../config';
import * as helper from '../helper';
import * as onboarding from '../commonTests/onboarding';

const testConfig = getTestConfig();

test.describe('Test Snowflake data source', () => {
  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('Connect Snowflake data source successfully', async ({ page }) => {
    await page.goto('/setup/connection');

    await page.locator('button').filter({ hasText: 'Snowflake' }).click();

    await page.getByLabel('Display name').click();
    await page.getByLabel('Display name').fill('test-snowflake');
    await page.getByLabel('Username').click();
    await page.getByLabel('Username').fill(testConfig.snowflake.username);
    await page.getByLabel('Password').click();
    await page.getByLabel('Password').fill(testConfig.snowflake.password);
    await page.getByLabel('Account').click();
    await page.getByLabel('Account').fill(testConfig.snowflake.account);
    await page.getByLabel('Database name').click();
    await page.getByLabel('Database name').fill(testConfig.snowflake.database);
    await page.getByLabel('Schema').click();
    await page.getByLabel('Schema').fill(testConfig.snowflake.schema);

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL('/setup/models', { timeout: 60000 });
  });

  test('Setup all models', onboarding.setupModels);

  test(
    'Save recommended relationships',
    onboarding.saveRecommendedRelationships,
  );
});
