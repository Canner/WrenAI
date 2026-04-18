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

    await page.getByLabel('显示名称').click();
    await page.getByLabel('显示名称').fill('test-duckdb');
    await page.getByLabel('初始化 SQL 语句').click();
    await page
      .getByLabel('初始化 SQL 语句')
      .fill(
        `CREATE TABLE ontime AS FROM read_csv('${testConfig.duckDb.sqlCsvPath}');`,
      );
    await page.getByRole('button', { name: 'Next' }).click();
    await helper.expectPathname({ page, pathname: '/setup/models' });
  });

  test('Setup all models', onboarding.setupModels);

  test(
    'Save recommended relationships',
    onboarding.saveRecommendedRelationships,
  );
});
