interface KnexOptions {
  dbType: string;
  pgUrl?: string;
  debug?: boolean;
  mssqlUrl?: string;
  mssqlHost?: string;
  mssqlPort?: number;
  mssqlDatabase?: string;
  mssqlUser?: string;
  mssqlPassword?: string;
  mssqlEncrypt?: boolean;
  mssqlTrustServerCertificate?: boolean;
  sqliteFile?: string;
}

const normalizeDbType = (dbType?: string) =>
  (dbType || 'mssql').trim().toLowerCase().replace(/[-_ ]/g, '');

const ensureMssqlConfig = (options: KnexOptions) => {
  if (options.mssqlUrl) {
    return;
  }

  const missingFields = [
    ['MSSQL_HOST', options.mssqlHost],
    ['MSSQL_DATABASE', options.mssqlDatabase],
    ['MSSQL_USER', options.mssqlUser],
    ['MSSQL_PASSWORD', options.mssqlPassword],
  ].filter(([, value]) => !value);

  if (missingFields.length > 0) {
    throw new Error(
      `MSSQL is the required Wren UI application database. Missing configuration: ${missingFields
        .map(([key]) => key)
        .join(', ')}`,
    );
  }
};

const parseBooleanUrlParam = (
  searchParams: URLSearchParams,
  key: string,
  fallback: boolean,
) => {
  const value = searchParams.get(key);
  if (value === null) return fallback;
  return value.toLowerCase() === 'true';
};

const getMssqlConnection = (options: KnexOptions) => {
  if (options.mssqlUrl) {
    const url = new URL(options.mssqlUrl);
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
    server: options.mssqlHost,
    port: options.mssqlPort || 1433,
    database: options.mssqlDatabase,
    user: options.mssqlUser,
    password: options.mssqlPassword,
    options: {
      encrypt: options.mssqlEncrypt ?? false,
      trustServerCertificate: options.mssqlTrustServerCertificate ?? true,
    },
  };
};

export const bootstrapKnex = (options: KnexOptions) => {
  const dbType = normalizeDbType(options.dbType);

  if (dbType === 'pg' || dbType === 'postgres' || dbType === 'postgresql') {
    const { pgUrl, debug } = options;
    console.log('using pg');
    /* eslint-disable @typescript-eslint/no-var-requires */
    return require('knex')({
      client: 'pg',
      connection: pgUrl,
      debug,
      pool: { min: 2, max: 10 },
    });
  }

  if (dbType === 'mssql' || dbType === 'sqlserver') {
    console.log('using mssql');
    ensureMssqlConfig(options);
    /* eslint-disable @typescript-eslint/no-var-requires */
    return require('knex')({
      client: 'mssql',
      connection: getMssqlConnection(options),
      debug: options.debug,
      pool: { min: 2, max: 10 },
    });
  }

  throw new Error(
    `Unsupported DB_TYPE "${options.dbType}". Wren UI application storage now requires MSSQL.`,
  );
};
