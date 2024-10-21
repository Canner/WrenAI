import fs from 'fs';
import knex from 'knex';
import { testDbConfig } from './config';
import { Page } from '@playwright/test';

export const migrateDatabase = async () => {
  const db = knex(testDbConfig);
  try {
    await db.migrate.latest();
    console.log('Database migration completed successfully.');
  } catch (error) {
    console.error('Error during database migration:', error);
  } finally {
    await db.destroy();
  }
};

export const removeDatabase = async () => {
  const db = knex(testDbConfig);
  try {
    await db.migrate.rollback();
    console.log('Database rollback completed successfully.');
    
    const isDBFileExist = fs.existsSync(testDbConfig.connection);
    if (isDBFileExist) {
      fs.unlinkSync(testDbConfig.connection);
      console.log('Database file deleted successfully.');
    }
  } catch (error) {
    console.error('Error during database removal:', error);
  } finally {
    await db.destroy();
  }
};

export const resetDatabase = async () => {
  const db = knex(testDbConfig);
  try {
    await db.transaction(async (trx) => {
      await trx.table('project').del();
      await trx.table('model').del();
      await trx.table('model_column').del();
      await trx.table('relation').del();
      await trx.table('thread').del();
      await trx.table('thread_response').del();
      await trx.table('view').del();
    });
    console.log('Database reset successfully.');
  } catch (error) {
    console.error('Error during database reset:', error);
  } finally {
    await db.destroy();
  }
};

export const waitForGraphQLResponse = async (page: Page) => {
  try {
    const response = await page.waitForResponse(
      (resp) => resp.url().includes('/api/graphql') && resp.status() === 200,
    );
    console.log('GraphQL response received successfully.');
    return response;
  } catch (error) {
    console.error('Error waiting for GraphQL response:', error);
    throw error;
  }
};
