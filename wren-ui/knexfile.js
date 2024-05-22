// Update with your config settings.

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
if (process.env.DB_TYPE === 'pg') {
  console.log('Using Postgres');
  module.exports = {
    client: 'pg',
    connection: process.env.PG_URL,
  };
} else {
  console.log('Using SQLite');
  module.exports = {
    client: 'better-sqlite3',
    connection: process.env.SQLITE_FILE || './db.sqlite3',
    useNullAsDefault: true,
  };
}
