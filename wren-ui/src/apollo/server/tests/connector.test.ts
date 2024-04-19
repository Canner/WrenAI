import { CompactTable } from '@server/connectors/connector';
import { PGColumnResponse, PGConnector } from '@server/connectors/pgConnector';
import { TestingEnv } from './env';
import { TestingPG } from './testingDatabase/pg';

describe('Connector', () => {
  let connector: PGConnector;
  let testingEnv: TestingEnv;
  let testingDatabase: TestingPG;

  // expected result
  const tpchTables = [
    'customer',
    'lineitem',
    'nation',
    'orders',
    'part',
    'partsupp',
    'region',
    'supplier',
  ];

  const tpchCustomerColumns = [
    {
      name: 'c_custkey',
      type: 'integer',
      notNull: true,
      description: '',
      properties: {
        ordinalPosition: 1,
      },
    },
    {
      name: 'c_name',
      type: 'character varying',
      notNull: true,
      description: '',
      properties: {
        ordinalPosition: 2,
      },
    },
    {
      name: 'c_address',
      type: 'character varying',
      notNull: true,
      description: '',
      properties: {
        ordinalPosition: 3,
      },
    },
    {
      name: 'c_nationkey',
      type: 'integer',
      notNull: true,
      description: '',
      properties: {
        ordinalPosition: 4,
      },
    },
    {
      name: 'c_phone',
      type: 'character',
      notNull: true,
      description: '',
      properties: {
        ordinalPosition: 5,
      },
    },
    {
      name: 'c_acctbal',
      type: 'numeric',
      notNull: true,
      description: '',
      properties: {
        ordinalPosition: 6,
      },
    },
    {
      name: 'c_mktsegment',
      type: 'character',
      notNull: true,
      description: '',
      properties: {
        ordinalPosition: 7,
      },
    },
    {
      name: 'c_comment',
      type: 'character varying',
      notNull: true,
      description: '',
      properties: {
        ordinalPosition: 8,
      },
    },
  ];

  beforeAll(async () => {
    testingEnv = new TestingEnv();
    testingDatabase = new TestingPG();

    // initialize
    await testingEnv.initialize();
    await testingDatabase.initialize(testingEnv.context);

    // create connector
    const container = testingDatabase.getContainer();
    connector = new PGConnector({
      user: container.getUsername(),
      password: container.getPassword(),
      host: container.getHost(),
      database: container.getDatabase(),
      port: container.getPort(),
    });
  }, 60000);

  afterAll(async () => {
    // close connector
    await connector.close();

    // finalize testing database
    await testingDatabase.finalize();
  });

  it('should test connect', async () => {
    const connected = await connector.connect();
    expect(connected).toBeTruthy();
  });

  it('should list tables with format: true', async () => {
    const tables = (await connector.listTables({
      format: true,
    })) as CompactTable[];

    // check if tables include tpch tables
    for (const table of tpchTables) {
      const found = tables.find((t: CompactTable) => t.name === table);
      expect(found).not.toBeNull();
    }

    // check if customer table has correct columns
    const customerTable = tables.find(
      (t: CompactTable) => t.name === 'customer',
    );
    expect(customerTable).not.toBeNull();
    expect(customerTable.columns).not.toBeNull();
    expect(customerTable.columns.length).toBe(tpchCustomerColumns.length);
    for (const column of tpchCustomerColumns) {
      const found = customerTable.columns.find(
        (c) => c.name === column.name && c.type === column.type,
      );
      expect(found).not.toBeNull();
      // check type, notNull, and ordinalPosition
      expect(found.type).toBe(column.type);
      expect(found.notNull).toBe(column.notNull);

      // properties will be an empty object
      expect(found.properties).toStrictEqual({});
    }
  });

  it('should list tables with format: false', async () => {
    const columns = (await connector.listTables({
      format: false,
    })) as PGColumnResponse[];

    // check if columns not null and has length
    expect(columns).not.toBeNull();
    expect(columns.length).toBeGreaterThan(0);

    // check the format of the columns
    /*
      the format of the columns should be like this:
      {
        table_catalog: 'test',
        table_schema: 'public',
        table_name: 'supplier',
        column_name: 's_comment',
        ordinal_position: 7,
        is_nullable: 'NO',
        data_type: 'character varying'
      }
    */
    const container = testingDatabase.getContainer();
    const expectedCatalog = container.getDatabase();
    const expectedSchema = 'public';
    const column = columns[0];
    expect(column.table_catalog).toBe(expectedCatalog);
    expect(column.table_schema).toBe(expectedSchema);
    expect(column.table_name).not.toBeNull();
    expect(column.column_name).not.toBeNull();
    expect(column.ordinal_position).not.toBeNull();
    expect(column.is_nullable).not.toBeNull();
    expect(column.data_type).not.toBeNull();
  });
});
