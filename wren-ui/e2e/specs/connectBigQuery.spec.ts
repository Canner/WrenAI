import { test, expect } from '@playwright/test';
import { getTestConfig } from '../config';
import * as helper from '../helper';
import * as onboarding from '../commonTests/onboarding';

const testConfig = getTestConfig();

test.describe('Test BigQuery data source', async () => {
  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('Connect BigQuery data source successfully', async ({ page }) => {
    await page.goto('/setup/connection');

    await page.locator('button').filter({ hasText: 'BigQuery' }).click();

    await page.getByLabel('Display name').click();
    await page.getByLabel('Display name').fill('test-bigquery');
    await page.getByLabel('Project ID').click();
    await page.getByLabel('Project ID').fill(testConfig.bigQuery.projectId);
    await page.getByLabel('Dataset ID').click();
    await page.getByLabel('Dataset ID').fill(testConfig.bigQuery.datasetId);

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page
      .locator('button')
      .filter({ hasText: 'Click to upload JSON key file' })
      .click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testConfig.bigQuery.credentialPath);

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL('/setup/models', { timeout: 60000 });
  });

  test('Setup all models', onboarding.setupModels);

  test(
    'Save recommended relationships',
    onboarding.saveRecommendedRelationships,
  );
});
