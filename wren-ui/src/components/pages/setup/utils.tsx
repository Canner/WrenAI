import { merge } from 'lodash';
import IconComponentProps from '@ant-design/icons';
import ShoppingCartOutlined from '@ant-design/icons/ShoppingCartOutlined';
import TrophyOutlined from '@ant-design/icons/TrophyOutlined';
import { SETUP, DATA_SOURCES } from '@/utils/enum';
import Starter from './Starter';
import ConnectDataSource from './ConnectDataSource';
import SelectModels from './SelectModels';
import DefineRelations from './DefineRelations';
import BigQueryProperties from './dataSources/BigQueryProperties';
import DuckDBProperties from './dataSources/DuckDBProperties';
import MySQLProperties from './dataSources/MySQLProperties';
import PostgreSQLProperties from './dataSources/PostgreSQLProperties';
import { SampleDatasetName } from '@/apollo/client/graphql/__types__';
import { ERROR_CODES } from '@/utils/errorHandler';

type SetupStep = {
  step: number;
  component: (
    props?: React.ComponentProps<typeof Starter> &
      React.ComponentProps<typeof ConnectDataSource> &
      React.ComponentProps<typeof SelectModels> &
      React.ComponentProps<typeof DefineRelations>,
  ) => JSX.Element;
  maxWidth?: number;
};

export type ButtonOption = {
  label: string;
  logo?: string;
  IconComponent?: typeof IconComponentProps;
  guide?: string;
  disabled?: boolean;
  submitting?: boolean;
  value?: string;
};

export const SETUP_STEPS = {
  [SETUP.STARTER]: {
    step: 0,
    component: Starter,
  },
  [SETUP.CREATE_DATA_SOURCE]: {
    step: 0,
    component: ConnectDataSource,
    maxWidth: 960,
  },
  [SETUP.SELECT_MODELS]: {
    step: 1,
    component: SelectModels,
    maxWidth: 960,
  },
  [SETUP.DEFINE_RELATIONS]: {
    step: 2,
    component: DefineRelations,
  },
} as { [key: string]: SetupStep };

export const DATA_SOURCE_OPTIONS = {
  [DATA_SOURCES.BIG_QUERY]: {
    label: 'BigQuery',
    logo: '/images/dataSource/bigQuery.svg',
    guide: 'https://docs.getwren.ai/guide/connect/bigquery',
    disabled: false,
  },
  [DATA_SOURCES.DUCKDB]: {
    label: 'DuckDB',
    logo: '/images/dataSource/duckDb.svg',
    guide: 'https://docs.getwren.ai/guide/connect/duckdb',
    disabled: false,
  },
  [DATA_SOURCES.PG_SQL]: {
    label: 'PostgreSQL',
    logo: '/images/dataSource/postgreSql.svg',
    guide: 'https://docs.getwren.ai/guide/connect/postgresql',
    disabled: false,
  },
  [DATA_SOURCES.MYSQL]: {
    label: 'MySQL',
    logo: '/images/dataSource/mysql.svg',
    guide: 'https://docs.getwren.ai/guide/connect/mysql',
    disabled: false,
  },
} as { [key: string]: ButtonOption };

export const DATA_SOURCE_FORM = {
  [DATA_SOURCES.BIG_QUERY]: { component: BigQueryProperties },
  [DATA_SOURCES.DUCKDB]: { component: DuckDBProperties },
  [DATA_SOURCES.PG_SQL]: { component: PostgreSQLProperties },
  [DATA_SOURCES.MYSQL]: { component: MySQLProperties },
};

export const TEMPLATE_OPTIONS = {
  [SampleDatasetName.ECOMMERCE]: {
    label: 'E-commerce',
    IconComponent: ShoppingCartOutlined,
  },
  [SampleDatasetName.NBA]: {
    label: 'NBA',
    IconComponent: TrophyOutlined,
  },
};

export const getDataSources = () => {
  return Object.keys(DATA_SOURCE_OPTIONS).map((key) => ({
    ...DATA_SOURCE_OPTIONS[key],
    value: key,
  })) as ButtonOption[];
};

export const getDataSource = (dataSource: DATA_SOURCES) => {
  const defaultDataSource = merge(
    DATA_SOURCE_OPTIONS[DATA_SOURCES.BIG_QUERY],
    DATA_SOURCE_FORM[DATA_SOURCES.BIG_QUERY],
  );
  return (
    {
      [DATA_SOURCES.BIG_QUERY]: defaultDataSource,
      [DATA_SOURCES.DUCKDB]: merge(
        DATA_SOURCE_OPTIONS[DATA_SOURCES.DUCKDB],
        DATA_SOURCE_FORM[DATA_SOURCES.DUCKDB],
      ),
      [DATA_SOURCES.PG_SQL]: merge(
        DATA_SOURCE_OPTIONS[DATA_SOURCES.PG_SQL],
        DATA_SOURCE_FORM[DATA_SOURCES.PG_SQL],
      ),
      [DATA_SOURCES.MYSQL]: merge(
        DATA_SOURCE_OPTIONS[DATA_SOURCES.MYSQL],
        DATA_SOURCE_FORM[DATA_SOURCES.MYSQL],
      ),
    }[dataSource] || defaultDataSource
  );
};

export const getTemplates = () => {
  return Object.keys(TEMPLATE_OPTIONS).map((key) => ({
    ...TEMPLATE_OPTIONS[key],
    value: key,
  })) as ButtonOption[];
};

export const getPostgresErrorMessage = (error: Record<string, any>) => {
  if (error.code === ERROR_CODES.CONNECTION_REFUSED) {
    return (
      <div>
        {error.message}. <br />
        If you are having trouble connecting to your PostgreSQL database, please
        refer to our{' '}
        <a
          href="https://docs.getwren.ai/guide/connect/postgresql#connect"
          target="_blank"
          rel="noopener noreferrer"
        >
          documentation
        </a>{' '}
        for detailed instructions.
      </div>
    );
  }
  return error.message;
};
