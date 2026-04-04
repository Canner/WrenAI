interface KnexOptions {
  dbType: string;
  pgUrl?: string;
  debug?: boolean;
  sqliteFile?: string;
}

export const bootstrapKnex = (options: KnexOptions) => {
  const normalizedDbType =
    options.dbType === 'postgres' ? 'pg' : options.dbType;

  if (normalizedDbType === 'pg') {
    const { pgUrl, debug } = options;
    if (!pgUrl) {
      throw new Error('PG_URL is required when DB_TYPE is pg');
    }
    console.log('using pg');
    /* eslint-disable @typescript-eslint/no-var-requires */
    return require('knex')({
      client: 'pg',
      connection: pgUrl,
      debug,
      pool: { min: 2, max: 10 },
    });
  }

  console.log('using sqlite');
  /* eslint-disable @typescript-eslint/no-var-requires */
  return require('knex')({
    client: 'better-sqlite3',
    connection: {
      filename: options.sqliteFile,
    },
    useNullAsDefault: true,
  });
};
