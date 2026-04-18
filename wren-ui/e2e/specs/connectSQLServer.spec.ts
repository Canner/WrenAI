import { test, expect } from '@playwright/test';
import { getTestConfig, hasConnectorE2EConfig } from '../config';
import * as helper from '../helper';
import * as onboarding from '../commonTests/onboarding';

const testConfig = getTestConfig();

test.describe('Test SQL Server data source', () => {
  test.skip(
    !hasConnectorE2EConfig('sqlserver'),
    'SQL Server E2E requires real connector settings in e2e/e2e.config.json.',
  );

  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('Connect SQL Server data source successfully', async ({ page }) => {
    await page.goto('/setup/connection');

    await page.locator('button').filter({ hasText: 'SQL Server' }).click();

    await page.getByLabel('显示名称').click();
    await page.getByLabel('显示名称').fill('test-sqlServer');
    await page.getByLabel('主机地址').click();
    await page.getByLabel('主机地址').fill(testConfig.sqlServer.host);
    await page.getByLabel('端口').click();
    await page.getByLabel('端口').fill(testConfig.sqlServer.port);
    await page.getByLabel('用户名').click();
    await page.getByLabel('用户名').fill(testConfig.sqlServer.username);
    await page.getByLabel('密码').click();
    await page.getByLabel('密码').fill(testConfig.sqlServer.password);
    await page.getByLabel('数据库名称').click();
    await page.getByLabel('数据库名称').fill(testConfig.sqlServer.database);

    await page.getByRole('button', { name: 'Next' }).click();
    await helper.expectPathname({ page, pathname: '/setup/models' });
  });

  test('Setup all models', onboarding.setupModels);

  test(
    'Save recommended relationships',
    onboarding.saveRecommendedRelationships,
  );
});
