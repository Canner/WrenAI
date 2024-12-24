// Refer to backend connector types:
// src/apollo/server/connectors/types.ts

export enum COLUMN_TYPE {
  // Boolean Types
  BOOLEAN = 'BOOLEAN',

  // Numeric Types
  TINYINT = 'TINYINT',

  INT2 = 'INT2',
  SMALLINT = 'SMALLINT', // alias for INT2

  INT4 = 'INT4',
  INTEGER = 'INTEGER', // alias for INT4

  INT8 = 'INT8',
  BIGINT = 'BIGINT', // alias for INT8

  INT64 = 'INT64',

  NUMERIC = 'NUMERIC',
  DECIMAL = 'DECIMAL',

  // Floating-Point Types
  FLOAT4 = 'FLOAT4',
  REAL = 'REAL', // alias for FLOAT4

  FLOAT8 = 'FLOAT8',
  DOUBLE = 'DOUBLE', // alias for FLOAT8

  // Character Types
  VARCHAR = 'VARCHAR',
  CHAR = 'CHAR',
  BPCHAR = 'BPCHAR', // BPCHAR is fixed-length, blank padded string
  TEXT = 'TEXT', // alias for VARCHAR
  STRING = 'STRING', // alias for VARCHAR
  NAME = 'NAME', // alias for VARCHAR

  // Date/Time Types
  TIMESTAMP = 'TIMESTAMP',
  TIMESTAMPTZ = 'TIMESTAMP WITH TIME ZONE',
  DATE = 'DATE',
  INTERVAL = 'INTERVAL',

  // JSON Types
  JSON = 'JSON',

  // Record Types
  RECORD = 'RECORD',

  // Object identifiers (OIDs) are used internally by PostgreSQL as primary keys for various system tables.
  // https://www.postgresql.org/docs/current/datatype-oid.html
  OID = 'OID',

  // Binary Data Types
  BYTEA = 'BYTEA',
  VARBINARY = 'VARBINARY',

  // UUID Type
  UUID = 'UUID',

  // Network Address Types
  INET = 'INET',

  // Unknown Type
  UNKNOWN = 'UNKNOWN',
}
