interface KnexOptions {
  pgUrl?: string;
  debug?: boolean;
}

export const bootstrapKnex = (options: KnexOptions) => {
  const { pgUrl, debug } = options;
  if (!pgUrl) {
    throw new Error('PG_URL is required. wren-ui now requires PostgreSQL.');
  }
  console.log('using PostgreSQL');
  /* eslint-disable @typescript-eslint/no-var-requires */
  return require('knex')({
    client: 'pg',
    connection: pgUrl,
    debug,
    pool: { min: 0, max: 5 },
  });
};
