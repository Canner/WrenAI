import knex from 'knex';
import { testDbConfig } from './config';
import { Page } from '@playwright/test';

export const migrateDatabase = async () => {
  const db = knex(testDbConfig);
  await db.migrate.latest();
};

export const removeDatabase = async () => {
  const db = knex(testDbConfig);
  try {
    await db.migrate.rollback(undefined, true);
  } finally {
    await db.destroy();
  }
};

export const resetDatabase = async () => {
  const db = knex(testDbConfig);
  await db.table('project').del();
  await db.table('model').del();
  await db.table('model_column').del();
  await db.table('model_nested_column').del();
  await db.table('relation').del();
  await db.table('thread').del();
  await db.table('thread_response').del();
  await db.table('view').del();

  // insert learning table data to skip guide
  await db.table('learning').insert({
    paths: JSON.stringify(['DATA_MODELING_GUIDE', 'SWITCH_PROJECT_LANGUAGE']),
  });
};

export const waitForJsonResponse = async (
  { page }: { page: Page },
  {
    urlIncludes,
    validateResponseData = (data: any) => data !== undefined,
  }: {
    urlIncludes: string;
    validateResponseData?: (data: any) => boolean;
  },
) => {
  await page.waitForResponse(
    async (response) => {
      try {
        const responseBody = await response.json();
        const responseData = responseBody;

        return (
          response.url().includes(urlIncludes) &&
          response.status() === 200 &&
          responseBody &&
          validateResponseData(responseData)
        );
      } catch (error) {
        console.error('Error fetching response body:', error);
      }
    },
    { timeout: 100000 },
  );
};
