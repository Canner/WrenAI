import fs from 'fs';
import knex from 'knex';
import { testDbConfig } from './config';
import { Page } from '@playwright/test';

export const migrateDatabase = async () => {
  const db = knex(testDbConfig);
  await db.migrate.latest();
};

export const removeDatabase = async () => {
  const db = knex(testDbConfig);
  await db.migrate.rollback().then(() => db.destroy());
  const isDBFileExist = fs.existsSync(testDbConfig.connection);
  if (isDBFileExist) {
    fs.unlinkSync(testDbConfig.connection);
  }
};

export const resetDatabase = async () => {
  const db = knex(testDbConfig);
  await db.table('project').del();
  await db.table('model').del();
  await db.table('model_column').del();
  await db.table('relation').del();
  await db.table('thread').del();
  await db.table('thread_response').del();
  await db.table('view').del();
};

export const waitForGraphQLResponse = (page: Page) => {
  return page.waitForResponse(
    (resp) => resp.url().includes('/api/graphql') && resp.status() === 200,
  );
};
