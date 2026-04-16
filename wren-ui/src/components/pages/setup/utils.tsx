import { merge } from 'lodash';
import { IconComponentProps } from '@/import/icon';
import ShoppingCartOutlined from '@ant-design/icons/ShoppingCartOutlined';
import IdCardOutlined from '@ant-design/icons/IdcardOutlined';
import { SETUP, DATA_SOURCES } from '@/utils/enum';
import Starter from './Starter';
import ConnectDataSource from './ConnectDataSource';
import SelectModels from './SelectModels';
import DefineRelations from './DefineRelations';
import { SampleDatasetName } from '@/types/api';
import { ERROR_CODES } from '@/utils/errorHandler';
import {
  getDataSourceConfig,
  getDataSourceFormComponent,
} from '@/utils/dataSourceType';

type SetupStep = {
  step: number;
  component: React.ComponentType<any>;
  maxWidth?: number;
};

export type ButtonOption = {
  label: string;
  logo?: string;
  IconComponent?: IconComponentProps['component'];
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
    ...getDataSourceConfig(DATA_SOURCES.BIG_QUERY),
    guide: 'https://docs.getwren.ai/oss/guide/connect/bigquery',
    disabled: false,
  },
  [DATA_SOURCES.DUCKDB]: {
    ...getDataSourceConfig(DATA_SOURCES.DUCKDB),
    guide: 'https://docs.getwren.ai/oss/guide/connect/duckdb',
    disabled: false,
  },
  [DATA_SOURCES.POSTGRES]: {
    ...getDataSourceConfig(DATA_SOURCES.POSTGRES),
    guide: 'https://docs.getwren.ai/oss/guide/connect/postgresql',
    disabled: false,
  },
  [DATA_SOURCES.MYSQL]: {
    ...getDataSourceConfig(DATA_SOURCES.MYSQL),
    guide: 'https://docs.getwren.ai/oss/guide/connect/mysql',
    disabled: false,
  },
  [DATA_SOURCES.ORACLE]: {
    ...getDataSourceConfig(DATA_SOURCES.ORACLE),
    guide: 'https://docs.getwren.ai/oss/guide/connect/oracle',
    disabled: false,
  },
  [DATA_SOURCES.MSSQL]: {
    ...getDataSourceConfig(DATA_SOURCES.MSSQL),
    guide: 'https://docs.getwren.ai/oss/guide/connect/sqlserver',
    disabled: false,
  },
  [DATA_SOURCES.CLICK_HOUSE]: {
    ...getDataSourceConfig(DATA_SOURCES.CLICK_HOUSE),
    guide: 'https://docs.getwren.ai/oss/guide/connect/clickhouse',
    disabled: false,
  },
  [DATA_SOURCES.TRINO]: {
    ...getDataSourceConfig(DATA_SOURCES.TRINO),
    guide: 'https://docs.getwren.ai/oss/guide/connect/trino',
    disabled: false,
  },
  [DATA_SOURCES.SNOWFLAKE]: {
    ...getDataSourceConfig(DATA_SOURCES.SNOWFLAKE),
    guide: 'https://docs.getwren.ai/oss/guide/connect/snowflake',
    disabled: false,
  },
  [DATA_SOURCES.ATHENA]: {
    ...getDataSourceConfig(DATA_SOURCES.ATHENA),
    guide: 'https://docs.getwren.ai/oss/guide/connect/athena',
    disabled: false,
  },
  [DATA_SOURCES.REDSHIFT]: {
    ...getDataSourceConfig(DATA_SOURCES.REDSHIFT),
    guide: 'https://docs.getwren.ai/oss/guide/connect/redshift',
    disabled: false,
  },
  [DATA_SOURCES.DATABRICKS]: {
    ...getDataSourceConfig(DATA_SOURCES.DATABRICKS),
    guide: 'https://docs.getwren.ai/oss/guide/connect/databricks',
    disabled: false,
  },
} as { [key: string]: ButtonOption };

export const TEMPLATE_OPTIONS = {
  [SampleDatasetName.ECOMMERCE]: {
    label: '电商订单数据',
    IconComponent: ShoppingCartOutlined,
    guide: 'https://docs.getwren.ai/oss/getting_started/sample_data/ecommerce',
  },
  [SampleDatasetName.HR]: {
    label: '人力资源数据',
    IconComponent: IdCardOutlined,
    guide: 'https://docs.getwren.ai/oss/getting_started/sample_data/hr',
  },
};

export const getDataSources = () => {
  return Object.values(DATA_SOURCE_OPTIONS) as ButtonOption[];
};

export const getDataSource = (dataSource: DATA_SOURCES) => {
  return merge(
    DATA_SOURCE_OPTIONS[dataSource],
    getDataSourceFormComponent(dataSource),
  );
};

export const getTemplates = () => {
  return Object.entries(TEMPLATE_OPTIONS).map(([key, option]) => ({
    ...option,
    value: key,
  })) as ButtonOption[];
};

export const getPostgresErrorMessage = (error: Record<string, any>) => {
  if (error.code === ERROR_CODES.CONNECTION_REFUSED) {
    return (
      <div>
        {error.message}。<br />
        如果你在连接 PostgreSQL 数据库时遇到问题，请参考我们的
        <a
          href="https://docs.getwren.ai/oss/guide/connect/postgresql#connect"
          target="_blank"
          rel="noopener noreferrer"
        >
          文档
        </a>
        获取详细说明。
      </div>
    );
  }
  return error.message;
};
