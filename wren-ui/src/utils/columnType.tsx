import {
  NumericIcon,
  ColumnsIcon,
  JsonBracesIcon,
  StringIcon,
  TextIcon,
  CalendarIcon,
  TickIcon,
  IdIcon,
  BinaryIcon,
} from './icons';
import { COLUMN_TYPE } from './enum';

export const getColumnTypeIcon = (payload: { type: string }, attrs?: any) => {
  const { type } = payload;
  const compareString = type.toUpperCase();
  switch (compareString) {
    case COLUMN_TYPE.BOOLEAN:
      return <TickIcon {...attrs} />;

    case COLUMN_TYPE.JSON:
    case COLUMN_TYPE.RECORD:
      return <JsonBracesIcon {...attrs} />;

    case COLUMN_TYPE.TEXT:
      return <TextIcon {...attrs} />;

    case COLUMN_TYPE.BYTEA:
    case COLUMN_TYPE.VARBINARY:
      return <BinaryIcon {...attrs} />;

    case COLUMN_TYPE.UUID:
    case COLUMN_TYPE.OID:
      return <IdIcon {...attrs} />;

    case COLUMN_TYPE.TINYINT:
    case COLUMN_TYPE.INT2:
    case COLUMN_TYPE.SMALLINT:
    case COLUMN_TYPE.INT4:
    case COLUMN_TYPE.INTEGER:
    case COLUMN_TYPE.INT8:
    case COLUMN_TYPE.BIGINT:
    case COLUMN_TYPE.INT64:
    case COLUMN_TYPE.NUMERIC:
    case COLUMN_TYPE.DECIMAL:
    case COLUMN_TYPE.FLOAT4:
    case COLUMN_TYPE.REAL:
    case COLUMN_TYPE.FLOAT8:
    case COLUMN_TYPE.DOUBLE:
    case COLUMN_TYPE.INET:
      return <NumericIcon {...attrs} />;

    case COLUMN_TYPE.VARCHAR:
    case COLUMN_TYPE.CHAR:
    case COLUMN_TYPE.BPCHAR:
    case COLUMN_TYPE.STRING:
    case COLUMN_TYPE.NAME:
      return <StringIcon {...attrs} />;

    case COLUMN_TYPE.TIMESTAMP:
    case COLUMN_TYPE.TIMESTAMPTZ:
    case COLUMN_TYPE.DATE:
    case COLUMN_TYPE.INTERVAL:
      return <CalendarIcon {...attrs} />;

    default: {
      return <ColumnsIcon {...attrs} />;
    }
  }
};
