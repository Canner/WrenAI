import { test, expect } from '@playwright/test';
import { getTestConfig, hasConnectorE2EConfig } from '../config';
import * as helper from '../helper';
import * as onboarding from '../commonTests/onboarding';

const testConfig = getTestConfig();

test.describe('Test Trino data source', () => {
  test.skip(
    !hasConnectorE2EConfig('trino'),
    'Trino E2E requires real connector settings in e2e/e2e.config.json.',
  );

  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('Connect Trino data source successfully', async ({ page }) => {
    await page.goto('/setup/connection');

    await page.locator('button').filter({ hasText: 'Trino' }).click();

    await page.getByLabel('显示名称').click();
    await page.getByLabel('显示名称').fill('test-trino');
    await page.getByLabel('主机地址').click();
    await page.getByLabel('主机地址').fill(testConfig.trino.host);
    await page.getByLabel('端口').click();
    await page.getByLabel('端口').fill(testConfig.trino.port);
    await page.getByLabel('Catalog').click();
    await page.getByLabel('Catalog').fill(testConfig.trino.catalog);
    await page.getByLabel('Schema 列表').click();
    await page.getByLabel('Schema 列表').fill(testConfig.trino.schema);
    await page.getByLabel('用户名').click();
    await page.getByLabel('用户名').fill(testConfig.trino.username);
    await page.getByLabel('密码').click();
    await page.getByLabel('密码').fill(testConfig.trino.password);

    await page.getByRole('button', { name: 'Next' }).click();
    await helper.expectPathname({ page, pathname: '/setup/models' });
  });

  test('Setup all models', onboarding.setupModels);

  test(
    'Save recommended relationships',
    onboarding.saveRecommendedRelationships,
  );
});
