import { test } from '@playwright/test';
import * as helper from '../helper';
import { SampleDatasetName } from '@/types/dataSource';

test.describe('Sample dataset import guard - Ecommerce', () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('rejects importing ecommerce sample dataset into a regular workspace', async ({
    page,
  }) => {
    await page.goto('/setup/connection');
    await helper.expectSampleDatasetImportRejectedViaRest({
      page,
      name: SampleDatasetName.ECOMMERCE,
    });
  });
});
