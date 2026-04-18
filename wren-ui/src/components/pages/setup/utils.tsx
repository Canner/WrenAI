import { merge } from 'lodash';
import { IconComponentProps } from '@/import/icon';
import ShoppingCartOutlined from '@ant-design/icons/ShoppingCartOutlined';
import IdCardOutlined from '@ant-design/icons/IdcardOutlined';
import { SETUP, DATA_SOURCES } from '@/utils/enum';
import Starter from './Starter';
import ConfigureConnection from './ConfigureConnection';
import SelectModels from './SelectModels';
import DefineRelations from './DefineRelations';
import { SampleDatasetName } from '@/types/dataSource';

import { ERROR_CODES } from '@/utils/errorHandler';
import {
  getConnectionTypeConfig,
  getConnectionTypeFormComponent,
} from '@/utils/connectionType';

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
  [SETUP.CREATE_CONNECTION]: {
    step: 0,
    component: ConfigureConnection,
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

export const CONNECTION_TYPE_OPTIONS = {
  [DATA_SOURCES.BIG_QUERY]: {
    ...getConnectionTypeConfig(DATA_SOURCES.BIG_QUERY),
    guide: 'https://docs.getwren.ai/oss/guide/connect/bigquery',
    disabled: false,
  },
  [DATA_SOURCES.DUCKDB]: {
    ...getConnectionTypeConfig(DATA_SOURCES.DUCKDB),
    guide: 'https://docs.getwren.ai/oss/guide/connect/duckdb',
    disabled: false,
  },
  [DATA_SOURCES.POSTGRES]: {
    ...getConnectionTypeConfig(DATA_SOURCES.POSTGRES),
    guide: 'https://docs.getwren.ai/oss/guide/connect/postgresql',
    disabled: false,
  },
  [DATA_SOURCES.MYSQL]: {
    ...getConnectionTypeConfig(DATA_SOURCES.MYSQL),
    guide: 'https://docs.getwren.ai/oss/guide/connect/mysql',
    disabled: false,
  },
  [DATA_SOURCES.ORACLE]: {
    ...getConnectionTypeConfig(DATA_SOURCES.ORACLE),
    guide: 'https://docs.getwren.ai/oss/guide/connect/oracle',
    disabled: false,
  },
  [DATA_SOURCES.MSSQL]: {
    ...getConnectionTypeConfig(DATA_SOURCES.MSSQL),
    guide: 'https://docs.getwren.ai/oss/guide/connect/sqlserver',
    disabled: false,
  },
  [DATA_SOURCES.CLICK_HOUSE]: {
    ...getConnectionTypeConfig(DATA_SOURCES.CLICK_HOUSE),
    guide: 'https://docs.getwren.ai/oss/guide/connect/clickhouse',
    disabled: false,
  },
  [DATA_SOURCES.TRINO]: {
    ...getConnectionTypeConfig(DATA_SOURCES.TRINO),
    guide: 'https://docs.getwren.ai/oss/guide/connect/trino',
    disabled: false,
  },
  [DATA_SOURCES.SNOWFLAKE]: {
    ...getConnectionTypeConfig(DATA_SOURCES.SNOWFLAKE),
    guide: 'https://docs.getwren.ai/oss/guide/connect/snowflake',
    disabled: false,
  },
  [DATA_SOURCES.ATHENA]: {
    ...getConnectionTypeConfig(DATA_SOURCES.ATHENA),
    guide: 'https://docs.getwren.ai/oss/guide/connect/athena',
    disabled: false,
  },
  [DATA_SOURCES.REDSHIFT]: {
    ...getConnectionTypeConfig(DATA_SOURCES.REDSHIFT),
    guide: 'https://docs.getwren.ai/oss/guide/connect/redshift',
    disabled: false,
  },
  [DATA_SOURCES.DATABRICKS]: {
    ...getConnectionTypeConfig(DATA_SOURCES.DATABRICKS),
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

export const getConnectionTypes = () => {
  return Object.values(CONNECTION_TYPE_OPTIONS) as ButtonOption[];
};

export const getConnectionType = (connectionType: DATA_SOURCES) => {
  return merge(
    CONNECTION_TYPE_OPTIONS[connectionType],
    getConnectionTypeFormComponent(connectionType),
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
