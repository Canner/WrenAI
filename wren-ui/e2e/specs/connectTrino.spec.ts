import { test, expect } from '@playwright/test';
import { getTestConfig } from '../config';
import * as helper from '../helper';
import * as onboarding from '../commonTests/onboarding';

const testConfig = getTestConfig();

test.describe('Test Trino data source', () => {
  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('Connect Trino data source successfully', async ({ page }) => {
    await page.goto('/setup/connection');

    await page.locator('button').filter({ hasText: 'Trino' }).click();

    await page.getByLabel('Display name').click();
    await page.getByLabel('Display name').fill('test-trino');
    await page.getByLabel('Host').click();
    await page.getByLabel('Host').fill(testConfig.trino.host);
    await page.getByLabel('Port').click();
    await page.getByLabel('Port').fill(testConfig.trino.port);
    await page.getByLabel('Catalog').click();
    await page.getByLabel('Catalog').fill(testConfig.trino.catalog);
    await page.getByLabel('Schema').click();
    await page.getByLabel('Schema').fill(testConfig.trino.schema);
    await page.getByLabel('Username').click();
    await page.getByLabel('Username').fill(testConfig.trino.username);
    await page.getByLabel('Password').click();
    await page.getByLabel('Password').fill(testConfig.trino.password);

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL('/setup/models', { timeout: 60000 });
  });

  test('Setup all models', onboarding.setupModels);

  test(
    'Save recommended relationships',
    onboarding.saveRecommendedRelationships,
  );
});
