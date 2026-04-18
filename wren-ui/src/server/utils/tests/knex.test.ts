import { bootstrapKnex } from '../knex';

describe('bootstrapKnex', () => {
  it('rejects missing pg connection strings', () => {
    expect(() => bootstrapKnex({ pgUrl: undefined })).toThrow(
      'PG_URL is required. wren-ui now requires PostgreSQL.',
    );
  });

  it('creates a PostgreSQL knex client', async () => {
    const knex = bootstrapKnex({
      pgUrl: 'postgres://postgres:postgres@127.0.0.1:9432/wrenai_test',
    });

    expect(knex.client.config.client).toBe('pg');
    expect(knex.client.config.connection).toMatchObject({
      host: '127.0.0.1',
      port: '9432',
      user: 'postgres',
      database: 'wrenai_test',
    });

    await knex.destroy();
  });
});
