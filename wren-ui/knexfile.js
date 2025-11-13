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
} else if (process.env.DB_TYPE === 'mysql') {
    console.log('Using MySQL at '+process.env.MYSQL_HOST+':'+(process.env.MYSQL_PORT || 3306));
    module.exports = {
      client: 'mysql2',
      connection: {
        host: process.env.MYSQL_HOST,
        port: +(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DB || 'wren_ui',
      },
      pool: { min: 2, max: 10 },
    };
} else {
  console.log('Using SQLite');
  module.exports = {
    client: 'better-sqlite3',
    connection: process.env.SQLITE_FILE || './db.sqlite3',
    useNullAsDefault: true,
  };
}
