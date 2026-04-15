const PG_URL =
  process.env.PG_URL || 'postgres://postgres:postgres@127.0.0.1:9432/wrenai';
const DEBUG = process.env.DEBUG === 'true';

const getKnex = () => {
  console.log('using PostgreSQL');
  /* eslint-disable @typescript-eslint/no-var-requires */
  return require('knex')({
    client: 'pg',
    connection: PG_URL,
    debug: DEBUG,
    pool: { min: 2, max: 10 },
  });
};

const main = async () => {
  const knex = getKnex();
  const query = knex.queryBuilder();

  const projects = await query
    .select('*')
    .from('instruction')
    .whereIn('id', [7, 8]);

  console.log(projects);
  process.exit(0);
};

main();
