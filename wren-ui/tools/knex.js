const fs = require('fs');
const path = require('path');

const DB_TYPE = process.env.DB_TYPE; // export DB_TYPE=pg
const PG_URL = process.env.PG_URL;
const DEBUG = process.env.DEBUG === 'true'; // export DEBUG=true
const SQLITE_FILE = process.env.SQLITE_FILE; // export SQLITE_FILE=./db.sqlite3

const APP_TABLE_ORDER = [
  'project',
  'roles',
  'users',
  'user_roles',
  'organization',
  'organization_members',
  'organization_member_projects',
  'organization_invitations',
  'organization_invitation_projects',
  'model',
  'model_column',
  'model_nested_column',
  'relation',
  'metric',
  'metric_measure',
  'view',
  'deploy_log',
  'thread',
  'thread_response',
  'schema_change',
  'learning',
  'dashboard',
  'dashboard_item',
  'sql_pair',
  'instruction',
  'dashboard_item_refresh_job',
  'asking_task',
  'api_history',
];

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

const getKnex = (options = {}) => {
  const dbType = normalizeDbType(options.dbType || DB_TYPE);

  if (dbType === 'pg' || dbType === 'postgres' || dbType === 'postgresql') {
    console.log('using pg');
    /* eslint-disable @typescript-eslint/no-var-requires */
    return require('knex')({
      client: 'pg',
      connection: PG_URL,
      debug: DEBUG,
      pool: { min: 2, max: 10 },
    });
  }

  if (dbType === 'mssql' || dbType === 'sqlserver') {
    console.log('using mssql');
    /* eslint-disable @typescript-eslint/no-var-requires */
    return require('knex')({
      client: 'mssql',
      connection: getMssqlConnection(),
      debug: DEBUG,
      pool: { min: 2, max: 10 },
    });
  }

  console.log('using sqlite');
  /* eslint-disable @typescript-eslint/no-var-requires */
  return require('knex')({
    client: 'better-sqlite3',
    connection: {
      filename: options.sqliteFile || SQLITE_FILE,
    },
    useNullAsDefault: true,
  });
};

const getSqliteFile = () => {
  const appRoot = path.resolve(__dirname, '..');
  const candidates = [
    SQLITE_FILE,
    path.join(appRoot, 'data', 'db.sqlite3'),
    path.join(appRoot, 'db.sqlite3'),
  ].filter(Boolean);

  const sqliteFile = candidates.find((candidate) => fs.existsSync(candidate));
  if (!sqliteFile) {
    throw new Error(
      `SQLite source database not found. Set SQLITE_FILE explicitly. Checked: ${candidates.join(
        ', ',
      )}`,
    );
  }
  return sqliteFile;
};

const getSourceTables = async (sourceDb) => {
  const rows = await sourceDb.raw(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT IN ('knex_migrations', 'knex_migrations_lock')
  `);
  const tableNames = rows.map((row) => row.name);
  const orderedTables = APP_TABLE_ORDER.filter((table) =>
    tableNames.includes(table),
  );
  const remainingTables = tableNames
    .filter((table) => !orderedTables.includes(table))
    .sort();
  return [...orderedTables, ...remainingTables];
};

const getTargetColumns = async (targetDb, tableName) => {
  const rows = await targetDb('INFORMATION_SCHEMA.COLUMNS')
    .select('COLUMN_NAME')
    .where({ TABLE_SCHEMA: 'dbo', TABLE_NAME: tableName })
    .orderBy('ORDINAL_POSITION', 'asc');
  return rows.map((row) => row.COLUMN_NAME);
};

const getTargetIdentityColumns = async (targetDb, tableName) => {
  const rows = await targetDb('INFORMATION_SCHEMA.COLUMNS')
    .select('COLUMN_NAME')
    .where({ TABLE_SCHEMA: 'dbo', TABLE_NAME: tableName })
    .whereRaw(
      "COLUMNPROPERTY(OBJECT_ID(TABLE_SCHEMA + '.' + TABLE_NAME), COLUMN_NAME, 'IsIdentity') = 1",
    );
  return rows.map((row) => row.COLUMN_NAME);
};

const parseCount = (row) => Number(row.count || row.Count || row[''] || 0);

const getTableCount = async (db, tableName) => {
  const [row] = await db(tableName).count({ count: '*' });
  return parseCount(row);
};

const ensureTargetIsEmpty = async (targetDb, tableNames) => {
  const nonEmptyTables = [];
  for (const tableName of tableNames) {
    if (!(await targetDb.schema.hasTable(tableName))) {
      continue;
    }
    const count = await getTableCount(targetDb, tableName);
    if (count > 0) {
      nonEmptyTables.push(`${tableName} (${count})`);
    }
  }

  if (nonEmptyTables.length > 0 && process.env.MIGRATE_OVERWRITE !== 'true') {
    throw new Error(
      `Refusing to copy into a non-empty MSSQL database. Non-empty tables: ${nonEmptyTables.join(
        ', ',
      )}. Set MIGRATE_OVERWRITE=true to delete target Wren UI rows first.`,
    );
  }
};

const setForeignKeysEnabled = async (targetDb, enabled) => {
  const rows = await targetDb
    .select(
      targetDb.raw(
        "QUOTENAME(SCHEMA_NAME(schema_id)) + '.' + QUOTENAME(name) AS full_name",
      ),
    )
    .from('sys.tables')
    .where({ is_ms_shipped: 0 });

  for (const row of rows) {
    const fullName = row.full_name || row.fullName;
    if (enabled) {
      await targetDb.raw(
        `ALTER TABLE ${fullName} WITH CHECK CHECK CONSTRAINT ALL`,
      );
    } else {
      await targetDb.raw(`ALTER TABLE ${fullName} NOCHECK CONSTRAINT ALL`);
    }
  }
};

const clearTargetTables = async (targetDb, tableNames) => {
  for (const tableName of [...tableNames].reverse()) {
    if (await targetDb.schema.hasTable(tableName)) {
      await targetDb(tableName).delete();
    }
  }
};

const copyTable = async (sourceDb, targetDb, tableName) => {
  if (!(await targetDb.schema.hasTable(tableName))) {
    console.log(`Skipping ${tableName}: target table does not exist`);
    return { tableName, sourceCount: 0, targetCount: 0 };
  }

  const sourceRows = await sourceDb(tableName).select('*');
  if (sourceRows.length === 0) {
    console.log(`Copied ${tableName}: 0 rows`);
    return {
      tableName,
      sourceCount: 0,
      targetCount: await getTableCount(targetDb, tableName),
    };
  }

  const targetColumns = await getTargetColumns(targetDb, tableName);
  const commonColumns = targetColumns.filter((column) =>
    Object.prototype.hasOwnProperty.call(sourceRows[0], column),
  );
  const rows = sourceRows.map((row) =>
    Object.fromEntries(commonColumns.map((column) => [column, row[column]])),
  );
  const chunkSize = Math.max(
    1,
    Math.floor(1800 / Math.max(commonColumns.length, 1)),
  );
  const identityColumns = await getTargetIdentityColumns(targetDb, tableName);
  const hasIdentityId =
    commonColumns.includes('id') && identityColumns.includes('id');

  if (hasIdentityId) {
    await targetDb.raw(`SET IDENTITY_INSERT [dbo].[${tableName}] ON`);
  }

  try {
    for (let index = 0; index < rows.length; index += chunkSize) {
      await targetDb(tableName).insert(rows.slice(index, index + chunkSize));
    }
  } finally {
    if (hasIdentityId) {
      await targetDb.raw(`SET IDENTITY_INSERT [dbo].[${tableName}] OFF`);
    }
  }

  const targetCount = await getTableCount(targetDb, tableName);
  console.log(`Copied ${tableName}: ${sourceRows.length} rows`);
  return { tableName, sourceCount: sourceRows.length, targetCount };
};

const migrateSqliteToMssql = async () => {
  const sqliteFile = getSqliteFile();
  const sourceDb = getKnex({ dbType: 'sqlite', sqliteFile });
  const targetDb = getKnex({ dbType: 'mssql' });

  try {
    const migrationsDir = path.resolve(__dirname, '..', 'migrations');
    console.log(`Migrating Wren UI application tables from ${sqliteFile}`);
    console.log('Running MSSQL schema migrations');
    await targetDb.migrate.latest({ directory: migrationsDir });

    const tableNames = await getSourceTables(sourceDb);
    await ensureTargetIsEmpty(targetDb, tableNames);

    await targetDb.transaction(async (trx) => {
      await setForeignKeysEnabled(trx, false);
      try {
        if (process.env.MIGRATE_OVERWRITE === 'true') {
          await clearTargetTables(trx, tableNames);
        }

        const verification = [];
        for (const tableName of tableNames) {
          verification.push(await copyTable(sourceDb, trx, tableName));
        }

        const mismatches = verification.filter(
          ({ sourceCount, targetCount }) => sourceCount !== targetCount,
        );
        if (mismatches.length > 0) {
          throw new Error(
            `Row-count verification failed: ${mismatches
              .map(
                ({ tableName, sourceCount, targetCount }) =>
                  `${tableName} sqlite=${sourceCount} mssql=${targetCount}`,
              )
              .join(', ')}`,
          );
        }
      } finally {
        await setForeignKeysEnabled(trx, true);
      }
    });

    console.log('SQLite to MSSQL migration completed successfully.');
  } finally {
    await sourceDb.destroy();
    await targetDb.destroy();
  }
};

const main = async () => {
  if (process.env.MIGRATE_SQLITE_TO_MSSQL === 'true') {
    await migrateSqliteToMssql();
    return;
  }

  const knex = getKnex();
  const query = knex.queryBuilder();

  const projects = await query
    .select('*')
    .from('instruction')
    .whereIn('id', [7, 8]);

  console.log(projects);
  await knex.destroy();
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
