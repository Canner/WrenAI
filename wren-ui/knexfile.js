// Update with your config settings.

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
const pgUrl =
  process.env.PG_URL || 'postgres://postgres:postgres@127.0.0.1:9432/wrenai';

console.log('Using PostgreSQL');
module.exports = {
  client: 'pg',
  connection: pgUrl,
};
