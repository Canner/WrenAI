import { test as setup } from '@playwright/test';
import * as helper from './helper';

setup('create new database', async () => {
  console.log('creating new database...');
  // Initialize the database
  await helper.migrateDatabase();
  console.log('created successfully.');
});
