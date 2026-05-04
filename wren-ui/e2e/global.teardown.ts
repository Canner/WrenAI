import { test as setup } from '@playwright/test';
import * as helper from './helper';

setup('delete database', async () => {
  console.log('deleting test database...');
  // Delete the database
  await helper.removeDatabase();
  console.log('deleted successfully.');
});
