// Update with your config settings.

const normalizeDbType = (dbType) =>
  (dbType || 'sqlite').trim().toLowerCase().replace(/[-_ ]/g, '');

const parseBooleanUrlParam = (searchParams, key, fallback) => {
  const value = searchParams.get(key);
  if (value === null) return fallback;
  return value.toLowerCase() === 'true';
};

const getMssqlConnection = () => {
  if (process.env.MSSQL_URL) {
    const url = new URL(process.env.MSSQL_URL);
    return {
      server: url.hostname,
      port: url.port ? parseInt(url.port) : 1433,
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      options: {
        encrypt: parseBooleanUrlParam(url.searchParams, 'encrypt', false),
        trustServerCertificate: parseBooleanUrlParam(
          url.searchParams,
          'trustServerCertificate',
          true,
        ),
      },
    };
  }

  return {
    server: process.env.MSSQL_HOST || 'localhost',
    port: process.env.MSSQL_PORT ? parseInt(process.env.MSSQL_PORT) : 1433,
    database: process.env.MSSQL_DATABASE || 'wren_ui',
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    options: {
      encrypt: process.env.MSSQL_ENCRYPT === 'true',
      trustServerCertificate:
        process.env.MSSQL_TRUST_SERVER_CERTIFICATE !== 'false',
    },
  };
};

const dbType = normalizeDbType(process.env.DB_TYPE);

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
if (dbType === 'pg' || dbType === 'postgres' || dbType === 'postgresql') {
  console.log('Using Postgres');
  module.exports = {
    client: 'pg',
    connection: process.env.PG_URL,
  };
} else if (dbType === 'mssql' || dbType === 'sqlserver') {
  console.log('Using MSSQL');
  module.exports = {
    client: 'mssql',
    connection: getMssqlConnection(),
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
