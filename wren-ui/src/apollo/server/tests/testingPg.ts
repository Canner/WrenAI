import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { TestingContext, TestingDatabase } from './testingDatabase';
import { Client } from 'pg';
import { getLogger } from '@server/utils';

const logger = getLogger('TestingPG');
logger.level = 'debug';

const psqlInitCommands = (dataDir: string) => `
CREATE TABLE NATION  (
  N_NATIONKEY  INT PRIMARY KEY,
  N_NAME       CHAR(25) NOT NULL,
  N_REGIONKEY  INT NOT NULL,
  N_COMMENT    VARCHAR(152)
);

CREATE TABLE REGION  (
  R_REGIONKEY  INT PRIMARY KEY,
  R_NAME       CHAR(25) NOT NULL,
  R_COMMENT    VARCHAR(152)
);

CREATE TABLE PART  (
  P_PARTKEY     INT PRIMARY KEY,
  P_NAME        VARCHAR(55) NOT NULL,
  P_MFGR        CHAR(25) NOT NULL,
  P_BRAND       CHAR(10) NOT NULL,
  P_TYPE        VARCHAR(25) NOT NULL,
  P_SIZE        INT NOT NULL,
  P_CONTAINER   CHAR(10) NOT NULL,
  P_RETAILPRICE DECIMAL(15,2) NOT NULL,
  P_COMMENT     VARCHAR(23) NOT NULL
);

CREATE TABLE SUPPLIER (
  S_SUPPKEY     INT PRIMARY KEY,
  S_NAME        CHAR(25) NOT NULL,
  S_ADDRESS     VARCHAR(40) NOT NULL,
  S_NATIONKEY   INT NOT NULL,
  S_PHONE       CHAR(15) NOT NULL,
  S_ACCTBAL     DECIMAL(15,2) NOT NULL,
  S_COMMENT     VARCHAR(101) NOT NULL
);

CREATE TABLE PARTSUPP (
  PS_PARTKEY     INT NOT NULL,
  PS_SUPPKEY     INT NOT NULL,
  PS_AVAILQTY    INT NOT NULL,
  PS_SUPPLYCOST  DECIMAL(15,2)  NOT NULL,
  PS_COMMENT     VARCHAR(199) NOT NULL
  -- PRIMARY KEY (PS_PARTKEY, PS_SUPPKEY)
);

CREATE TABLE CUSTOMER (
  C_CUSTKEY     INT PRIMARY KEY,
  C_NAME        VARCHAR(25) NOT NULL,
  C_ADDRESS     VARCHAR(40) NOT NULL,
  C_NATIONKEY   INT NOT NULL,
  C_PHONE       CHAR(15) NOT NULL,
  C_ACCTBAL     DECIMAL(15,2)   NOT NULL,
  C_MKTSEGMENT  CHAR(10) NOT NULL,
  C_COMMENT     VARCHAR(117) NOT NULL
);

CREATE TABLE ORDERS (
  O_ORDERKEY       INT PRIMARY KEY,
  O_CUSTKEY        INT NOT NULL,
  O_ORDERSTATUS    CHAR(1) NOT NULL,
  O_TOTALPRICE     DECIMAL(15,2) NOT NULL,
  O_ORDERDATE      DATE NOT NULL,
  O_ORDERPRIORITY  CHAR(15) NOT NULL,
  O_CLERK          CHAR(15) NOT NULL,
  O_SHIPPRIORITY   INT NOT NULL,
  O_COMMENT        VARCHAR(79) NOT NULL
);

CREATE TABLE LINEITEM (
  L_ORDERKEY      INT NOT NULL,
  L_PARTKEY       INT NOT NULL,
  L_SUPPKEY       INT NOT NULL,
  L_LINENUMBER    INT NOT NULL,
  L_QUANTITY      DECIMAL(15,2) NOT NULL,
  L_EXTENDEDPRICE DECIMAL(15,2) NOT NULL,
  L_DISCOUNT      DECIMAL(15,2) NOT NULL,
  L_TAX           DECIMAL(15,2) NOT NULL,
  L_RETURNFLAG    CHAR(1) NOT NULL,
  L_LINESTATUS    CHAR(1) NOT NULL,
  L_SHIPDATE      DATE NOT NULL,
  L_COMMITDATE    DATE NOT NULL,
  L_RECEIPTDATE   DATE NOT NULL,
  L_SHIPINSTRUCT  CHAR(25) NOT NULL,
  L_SHIPMODE      CHAR(10) NOT NULL,
  L_COMMENT       VARCHAR(44) NOT NULL
  -- PRIMARY KEY (L_ORDERKEY, L_LINENUMBER)
);

-- COPY
COPY NATION FROM '${dataDir}/nation.csv' DELIMITER ',' CSV HEADER;
COPY REGION FROM '${dataDir}/region.csv' DELIMITER ',' CSV HEADER;
COPY PART FROM '${dataDir}/part.csv' DELIMITER ',' CSV HEADER;
COPY SUPPLIER FROM '${dataDir}/supplier.csv' DELIMITER ',' CSV HEADER;
COPY PARTSUPP FROM '${dataDir}/partsupp.csv' DELIMITER ',' CSV HEADER;
COPY CUSTOMER FROM '${dataDir}/customer.csv' DELIMITER ',' CSV HEADER;
COPY ORDERS FROM '${dataDir}/orders.csv' DELIMITER ',' CSV HEADER;
COPY LINEITEM FROM '${dataDir}/lineitem.csv' DELIMITER ',' CSV HEADER;
`;

export class TestingPG implements TestingDatabase<StartedPostgreSqlContainer> {
  private container: StartedPostgreSqlContainer;

  public async initialize(context: TestingContext): Promise<void> {
    const { dataDir } = context.tpch;
    // dataDir that copied into container
    const containerDataDir = '/etc/testing_data';

    logger.info('Initializing TestingPG');
    const container = await new PostgreSqlContainer()
      .withExposedPorts({
        container: 5432,
        host: 8432,
      })
      .withCopyDirectoriesToContainer([
        {
          source: dataDir,
          target: containerDataDir,
        },
      ])
      .start();

    // running init commands
    const client = new Client({
      connectionString: container.getConnectionUri(),
    });

    // connect to container and run init commands
    logger.info('Running init commands');
    await client.connect();
    await client.query(psqlInitCommands(containerDataDir));
    await client.end();

    // assign container to instance
    logger.info('Container started');
    this.container = container;
  }

  public getContainer(): StartedPostgreSqlContainer {
    return this.container;
  }

  public async finalize(): Promise<void> {
    logger.info('Stopping container');
    await this.container.stop();
  }
}
