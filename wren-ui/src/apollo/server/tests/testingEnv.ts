import { TestingContext } from './testingDatabase';
import { Database } from 'duckdb-async';
import { getLogger } from '@server/utils';
import * as tmp from 'tmp';

const logger = getLogger('TestingEnv');
logger.level = 'debug';

export class TestingEnv {
  public context: TestingContext;

  constructor() {
    this.context = {
      tpch: {},
    };
  }

  public async initialize(): Promise<void> {
    await this.prepareTpchData();
  }

  private async prepareTpchData(): Promise<void> {
    logger.info('Preparing TPCH data');
    // run duckdb to load tpch data
    const db = await Database.create(':memory:');
    await db.run('INSTALL tpch');
    await db.run('LOAD tpch');
    await db.run('CALL dbgen(sf = 0.001)');

    // output tpch data as csv to tmp dir
    const tmpDir = tmp.dirSync();
    const rows = await db.all('SHOW TABLES');
    /*
      rows will be like
      [
        { name: 'customer' },
        { name: 'lineitem' },
        { name: 'nation' },
        { name: 'orders' },
        { name: 'part' },
        { name: 'partsupp' },
        { name: 'region' },
        { name: 'supplier' }
      ]
    */
    for (const row of rows) {
      const table = row.name;
      // run COPY command to output csv
      // COPY customer TO 'output.csv' (HEADER, DELIMITER ',')
      logger.info(`Exporting ${table} as csv to ${tmpDir.name}/${table}.csv`);
      await db.run(
        `COPY ${table} TO '${tmpDir.name}/${table}.csv' (HEADER, DELIMITER ',')`,
      );
    }

    // set context
    this.context.tpch.dataDir = tmpDir.name;
  }
}
