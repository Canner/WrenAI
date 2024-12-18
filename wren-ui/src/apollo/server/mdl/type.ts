export interface ColumnMDL {
  name: string; // eg: "orderkey", "custkey", "orderstatus"
  type?: string; // eg: "integer", "string", "relationName"
  isCalculated: boolean; // eg: true, false
  notNull?: boolean; // eg: true, false
  relationship?: string; //eg: OrdersCustomer
  properties?: {
    description?: string; // eg: "the key of each order"
    displayName?: string; // eg: "Order Key"
  };
  expression?: string; // eg: "SUM(orders.totalprice)"
}

export interface ModelMDL {
  name: string; // eg: "OrdersModel", "LineitemModel"
  refSql?: string; // eg: "select * from orders", "select * from lineitem"
  tableReference?: TableReference;
  columns?: ColumnMDL[];
  primaryKey?: string; // eg: "orderkey", "custkey"
  cached: boolean; // eg true, false
  refreshTime?: string; // eg: "30.00m"
  properties?: {
    description?: string; // eg: "tpch tiny orders table"
    displayName?: string; // eg: "Orders"
  };
}

export interface RelationMDL {
  name: string; // eg: "OrdersCustomer"
  models: string[]; // eg: ["OrdersModel", "CustomerModel"]
  joinType: string; // eg: "MANY_TO_ONE"
  condition: string; // eg: "OrdersModel.custkey = CustomerModel.custkey"
  manySideSortKeys?: {
    name: string; // eg: "orderkey"
    descending: boolean; // eg: false
  }[];
  description?: string; // eg: "the relationship between orders and customers"
  properties?: {
    description?: string; // eg: "the relationship between orders and customers"
  };
}

export interface EnumDefinition {
  name: string; // eg: "OrderStatus"
  values: {
    name: string; // eg: "PENDING", "PROCESSING"
    value: string; // eg: "pending", "processing"
    properties?: {
      description?: string; // eg: "pending"
    };
  }[];
  description?: string; // eg: "the status of an order"
  properties?: {
    description?: string; // eg: "the status of an order"
  };
}

export interface ViewMDL {
  name: string;
  statement: string;
  properties?: {
    displayName?: string;
    description?: string;
    viewId?: string;
    question?: string;
    summary?: string;
  };
}

export interface Manifest {
  catalog?: string; // eg: "test-catalog"
  schema?: string; // eg: "test-schema"
  dataSource?: WrenEngineDataSourceType;
  models?: Partial<ModelMDL>[]; // use partial since Rust version doesn't support null values, we need to remove all the null values
  relationships?: Partial<RelationMDL>[]; // use partial since Rust version doesn't support null values, we need to remove all the null values
  enumDefinitions?: Partial<EnumDefinition>[]; // use partial since Rust version doesn't support null values, we need to remove all the null values
  views?: Partial<ViewMDL>[]; // use partial since Rust version doesn't support null values, we need to remove all the null values
}

export interface TableReference {
  schema?: string;
  catalog?: string;
  table: string;
}

export enum WrenEngineDataSourceType {
  BIGQUERY = 'BIGQUERY',
  CANNER = 'CANNER',
  CLICKHOUSE = 'CLICKHOUSE',
  MSSQL = 'MSSQL',
  MYSQL = 'MYSQL',
  POSTGRES = 'POSTGRES',
  SNOWFLAKE = 'SNOWFLAKE',
  TRINO = 'TRINO',
  DUCKDB = 'DUCKDB',
  // accepted by the wren engine, but not supported by the wren ui
  DATAFUSION = 'DATAFUSION',
}
