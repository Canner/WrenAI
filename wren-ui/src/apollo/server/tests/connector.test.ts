import { CompactTable } from '@server/connectors/connector';
import {
  PostgresColumnResponse,
  PostgresConnector,
} from '@server/connectors/postgresConnector';
import { TestingEnv } from './env';
import { TestingPostgres } from './testingDatabase/postgres';
import { WrenEngineColumnType } from '@server/connectors/types';

describe('Connector', () => {
  let connector: PostgresConnector;
  let testingEnv: TestingEnv;
  let testingDatabase: TestingPostgres;

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
      type: WrenEngineColumnType.INTEGER,
      notNull: true,
      description: '',
      properties: {
        ordinalPosition: 1,
      },
    },
    {
      name: 'c_name',
      type: WrenEngineColumnType.VARCHAR,
      notNull: true,
      description: '',
      properties: {
        ordinalPosition: 2,
      },
    },
    {
      name: 'c_address',
      type: WrenEngineColumnType.VARCHAR,
      notNull: true,
      description: '',
      properties: {
        ordinalPosition: 3,
      },
    },
    {
      name: 'c_nationkey',
      type: WrenEngineColumnType.INTEGER,
      notNull: true,
      description: '',
      properties: {
        ordinalPosition: 4,
      },
    },
    {
      name: 'c_phone',
      type: WrenEngineColumnType.CHAR,
      notNull: true,
      description: '',
      properties: {
        ordinalPosition: 5,
      },
    },
    {
      name: 'c_acctbal',
      type: WrenEngineColumnType.DECIMAL,
      notNull: true,
      description: '',
      properties: {
        ordinalPosition: 6,
      },
    },
    {
      name: 'c_mktsegment',
      type: WrenEngineColumnType.CHAR,
      notNull: true,
      description: '',
      properties: {
        ordinalPosition: 7,
      },
    },
    {
      name: 'c_comment',
      type: WrenEngineColumnType.VARCHAR,
      notNull: true,
      description: '',
      properties: {
        ordinalPosition: 8,
      },
    },
  ];
  const expectedConstraints = [
    {
      constraintName: 'supplier_nation_fkey',
      constraintType: 'FOREIGN KEY',
      constraintTable: 'public.supplier',
      constraintColumn: 's_nationkey',
      constraintedTable: 'public.nation',
      constraintedColumn: 'n_nationkey',
    },
    {
      constraintName: 'partsupp_part_fkey',
      constraintType: 'FOREIGN KEY',
      constraintTable: 'public.partsupp',
      constraintColumn: 'ps_partkey',
      constraintedTable: 'public.part',
      constraintedColumn: 'p_partkey',
    },
    {
      constraintName: 'partsupp_supplier_fkey',
      constraintType: 'FOREIGN KEY',
      constraintTable: 'public.partsupp',
      constraintColumn: 'ps_suppkey',
      constraintedTable: 'public.supplier',
      constraintedColumn: 's_suppkey',
    },
    {
      constraintName: 'customer_nation_fkey',
      constraintType: 'FOREIGN KEY',
      constraintTable: 'public.customer',
      constraintColumn: 'c_nationkey',
      constraintedTable: 'public.nation',
      constraintedColumn: 'n_nationkey',
    },
    {
      constraintName: 'orders_customer_fkey',
      constraintType: 'FOREIGN KEY',
      constraintTable: 'public.orders',
      constraintColumn: 'o_custkey',
      constraintedTable: 'public.customer',
      constraintedColumn: 'c_custkey',
    },
    {
      constraintName: 'lineitem_orders_fkey',
      constraintType: 'FOREIGN KEY',
      constraintTable: 'public.lineitem',
      constraintColumn: 'l_orderkey',
      constraintedTable: 'public.orders',
      constraintedColumn: 'o_orderkey',
    },
    {
      constraintName: 'nation_region_fkey',
      constraintType: 'FOREIGN KEY',
      constraintTable: 'public.nation',
      constraintColumn: 'n_regionkey',
      constraintedTable: 'public.region',
      constraintedColumn: 'r_regionkey',
    },
  ];

  beforeAll(async () => {
    testingEnv = new TestingEnv();
    testingDatabase = new TestingPostgres();

    // initialize
    await testingEnv.initialize();
    await testingDatabase.initialize(testingEnv.context);

    // create connector
    const container = testingDatabase.getContainer();
    connector = new PostgresConnector({
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
      const found = tables.find(
        (t: CompactTable) => t.name === `public.${table}`,
      );
      expect(found).toBeTruthy();
    }

    // check if customer table has correct columns
    const customerTable = tables.find(
      (t: CompactTable) => t.name === 'public.customer',
    );
    expect(customerTable).toBeTruthy();
    expect(customerTable.columns).toBeTruthy();
    expect(customerTable.columns.length).toBe(tpchCustomerColumns.length);

    for (const column of tpchCustomerColumns) {
      const found = customerTable.columns.find(
        (c) => c.name === column.name && c.type === column.type,
      );
      expect(found).toBeTruthy();
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
    })) as PostgresColumnResponse[];

    // check if columns not null and has length
    expect(columns).toBeTruthy();
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
    expect(column.table_name).toBeTruthy();
    expect(column.column_name).toBeTruthy();
    expect(column.ordinal_position).toBeTruthy();
    expect(column.is_nullable).toBeTruthy();
    expect(column.data_type).toBeTruthy();
  });

  it('should list constraints', async () => {
    const constraints = await connector.listConstraints();

    // compare the constraints with the expected constraints
    expect(constraints).toBeTruthy();
    expect(constraints.length).toBe(expectedConstraints.length);
    for (const constraint of expectedConstraints) {
      const found = constraints.find(
        (c) =>
          c.constraintName === constraint.constraintName &&
          c.constraintType === constraint.constraintType &&
          c.constraintTable === constraint.constraintTable &&
          c.constraintColumn === constraint.constraintColumn &&
          c.constraintedTable === constraint.constraintedTable &&
          c.constraintedColumn === constraint.constraintedColumn,
      );
      expect(found).toBeTruthy();
    }
  });
});
