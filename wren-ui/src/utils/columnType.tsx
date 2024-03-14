import {
  NumericIcon,
  ColumnsIcon,
  JsonBracesIcon,
  ArrayBracketsIcon,
  StringIcon,
  TextIcon,
  CalendarIcon,
  TickIcon,
} from './icons';
import { COLUMN_TYPE } from './enum';

export const getColumnTypeIcon = (payload: { type: string }, attrs?: any) => {
  const { type } = payload;
  switch (type.toUpperCase()) {
    case COLUMN_TYPE.INTEGER:
    case COLUMN_TYPE.TINYINT:
    case COLUMN_TYPE.SMALLINT:
    case COLUMN_TYPE.BIGINT:
    case COLUMN_TYPE.INT:
    case COLUMN_TYPE.DECIMAL:
    case COLUMN_TYPE.DOUBLE:
    case COLUMN_TYPE.REAL:
    case COLUMN_TYPE.NUMBER:
      return <NumericIcon {...attrs} />;

    case COLUMN_TYPE.BOOLEAN:
      return <TickIcon {...attrs} />;

    case COLUMN_TYPE.CHAR:
    case COLUMN_TYPE.JSON:
    case COLUMN_TYPE.VARBINARY:
    case COLUMN_TYPE.VARCHAR:
    case COLUMN_TYPE.STRING:
      return <StringIcon {...attrs} />;

    case COLUMN_TYPE.TEXT:
      return <TextIcon {...attrs} />;

    case COLUMN_TYPE.DATE:
    case COLUMN_TYPE.DATETIME:
    case COLUMN_TYPE.TIME:
    case COLUMN_TYPE.TIMESTAMP:
      return <CalendarIcon {...attrs} />;

    case COLUMN_TYPE.MONGO_ARRAY:
      return <ArrayBracketsIcon {...attrs} />;

    case COLUMN_TYPE.MONGO_ROW:
      return <JsonBracesIcon {...attrs} />;

    default:
      return <ColumnsIcon {...attrs} />;
  }
};
