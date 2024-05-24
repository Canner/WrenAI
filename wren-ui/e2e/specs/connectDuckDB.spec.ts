import { test, expect } from '@playwright/test';
import { getTestConfig } from '../config';
import * as helper from '../helper';
import * as onboarding from '../commonTests/onboarding';

const testConfig = getTestConfig();

test.describe('Test DuckDB data source', () => {
  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('Connect DuckDB data source successfully', async ({ page }) => {
    await page.goto('/setup/connection');

    await page.locator('button').filter({ hasText: 'DuckDB' }).click();

    await page.getByLabel('Display name').click();
    await page.getByLabel('Display name').fill('test-duckdb');
    await page.getByLabel('Initial SQL statements').click();
    await page
      .getByLabel('Initial SQL statements')
      .fill(
        `CREATE TABLE ontime AS FROM read_csv('${testConfig.duckDb.sqlCsvPath}');`,
      );
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL('/setup/models', { timeout: 60000 });
  });

  test('Setup all models', onboarding.setupModels);

  test(
    'Save recommended relationships',
    onboarding.saveRecommendedRelationships,
  );
});
