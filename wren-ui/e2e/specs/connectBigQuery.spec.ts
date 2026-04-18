import { test, expect } from '@playwright/test';
import { getTestConfig, hasBigQueryE2EConfig } from '../config';
import * as helper from '../helper';
import * as onboarding from '../commonTests/onboarding';

const testConfig = getTestConfig();

test.describe('Test BigQuery data source', async () => {
  test.skip(
    !hasBigQueryE2EConfig(),
    'BigQuery E2E requires e2e/e2e.config.json plus a valid JSON credential file.',
  );

  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('Connect BigQuery data source successfully', async ({ page }) => {
    await page.goto('/setup/connection');

    await page.locator('button').filter({ hasText: 'BigQuery' }).click();

    await page.getByLabel('显示名称').click();
    await page.getByLabel('显示名称').fill('test-bigquery');
    await page.getByLabel('项目 ID').click();
    await page.getByLabel('项目 ID').fill(testConfig.bigQuery.projectId);
    await page.getByLabel('数据集 ID').click();
    await page.getByLabel('数据集 ID').fill(testConfig.bigQuery.datasetId);

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page
      .locator('button')
      .filter({ hasText: '上传 JSON 密钥文件' })
      .click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testConfig.bigQuery.credentialPath);

    await page.getByRole('button', { name: 'Next' }).click();
    await helper.expectPathname({ page, pathname: '/setup/models' });
  });

  test('Setup all models', onboarding.setupModels);

  test(
    'Save recommended relationships',
    onboarding.saveRecommendedRelationships,
  );
});
