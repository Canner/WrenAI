const DB_TYPE = process.env.DB_TYPE; // export DB_TYPE=pg
const PG_URL = process.env.PG_URL;
const DEBUG = process.env.DEBUG === 'true'; // export DEBUG=true
const SQLITE_FILE = process.env.SQLITE_FILE; // export SQLITE_FILE=./db.sqlite3

const getKnex = () => {
  if (DB_TYPE === 'pg') {
    console.log('using pg');
    /* eslint-disable @typescript-eslint/no-var-requires */
    return require('knex')({
      client: 'pg',
      connection: PG_URL,
      debug: DEBUG,
      pool: { min: 2, max: 10 },
    });
  } else {
    console.log('using sqlite');
    /* eslint-disable @typescript-eslint/no-var-requires */
    return require('knex')({
      client: 'better-sqlite3',
      connection: {
        filename: SQLITE_FILE,
      },
      useNullAsDefault: true,
    });
  }
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
