import { test, expect } from '@playwright/test';
import { getTestConfig, hasConnectorE2EConfig } from '../config';
import * as helper from '../helper';
import * as onboarding from '../commonTests/onboarding';

const testConfig = getTestConfig();

test.describe('Test Snowflake data source', () => {
  test.skip(
    !hasConnectorE2EConfig('snowflake'),
    'Snowflake E2E requires real connector settings in e2e/e2e.config.json.',
  );

  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('Connect Snowflake data source successfully', async ({ page }) => {
    await page.goto('/setup/connection');

    await page.locator('button').filter({ hasText: 'Snowflake' }).click();

    await page.getByLabel('显示名称').click();
    await page.getByLabel('显示名称').fill('test-snowflake');
    await page.getByLabel('用户').click();
    await page.getByLabel('用户').fill(testConfig.snowflake.username);
    await page.getByLabel('密码').click();
    await page.getByLabel('密码').fill(testConfig.snowflake.password);
    await page.getByLabel('账号标识（Account）').click();
    await page
      .getByLabel('账号标识（Account）')
      .fill(testConfig.snowflake.account);
    await page.getByLabel('数据库名称').click();
    await page.getByLabel('数据库名称').fill(testConfig.snowflake.database);
    await page.getByLabel('Schema').click();
    await page.getByLabel('Schema').fill(testConfig.snowflake.schema);

    await page.getByRole('button', { name: 'Next' }).click();
    await helper.expectPathname({ page, pathname: '/setup/models' });
  });

  test('Setup all models', onboarding.setupModels);

  test(
    'Save recommended relationships',
    onboarding.saveRecommendedRelationships,
  );
});
