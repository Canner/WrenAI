import Starter from './Starter';
import ConnectDataSource from './ConnectDataSource';
import SelectModels from './SelectModels';
import CreateModels from './CreateModels';
import RecommendRelations from './RecommendRelations';
import DefineRelations from './DefineRelations';
import {
  SETUP,
  DATA_SOURCES,
  DEMO_TEMPLATES,
} from '@/utils/enum';
import BigQueryProperties from './dataSources/BigQueryProperties';
import { merge } from 'lodash';

type SetupStep = {
  step: number;
  component: (
    props?: React.ComponentProps<typeof Starter> &
      React.ComponentProps<typeof ConnectDataSource> &
      React.ComponentProps<typeof SelectModels> &
      React.ComponentProps<typeof CreateModels> &
      React.ComponentProps<typeof RecommendRelations> &
      React.ComponentProps<typeof DefineRelations>
  ) => JSX.Element;
  maxWidth?: number;
};

export type ButtonOption = {
  label: string;
  logo: string;
  guide: string;
  disabled: boolean;
};

export const SETUP_STEPS = {
  [SETUP.STARTER]: {
    step: 0,
    component: Starter,
  },
  [SETUP.CREATE_DATA_SOURCE]: {
    step: 0,
    component: ConnectDataSource,
    maxWidth: 800,
  },
  [SETUP.SELECT_MODELS]: {
    step: 1,
    component: SelectModels,
  },
  [SETUP.CREATE_MODELS]: {
    step: 1,
    component: CreateModels,
  },
  [SETUP.RECOMMEND_RELATIONS]: {
    step: 2,
    component: RecommendRelations,
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
    guide: '',
    disabled: false,
  },
  [DATA_SOURCES.DATA_BRICKS]: {
    label: 'Databricks',
    logo: '/images/dataSource/dataBricks.svg',
    guide: '',
    disabled: true,
  },
  [DATA_SOURCES.SNOWFLAKE]: {
    label: 'Snowflake',
    logo: '/images/dataSource/snowflake.svg',
    guide: '',
    disabled: true,
  },
  [DATA_SOURCES.TRINO]: {
    label: 'Trino',
    logo: '',
    guide: '',
    disabled: true,
  },
} as { [key: string]: ButtonOption };

export const DATA_SOURCE_FORM = {
  [DATA_SOURCES.BIG_QUERY]: { component: BigQueryProperties },
};

export const TEMPLATE_OPTIONS = {
  [DEMO_TEMPLATES.CRM]: {
    label: 'CRM',
    logo: '',
  },
  [DEMO_TEMPLATES.ECORMERCE]: {
    label: 'E-commerce',
    logo: '',
  },
};

export const getDataSources = () => {
  return Object.keys(DATA_SOURCE_OPTIONS).map((key) => ({
    ...DATA_SOURCE_OPTIONS[key],
    value: key,
  })) as (ButtonOption & { value: DATA_SOURCES })[];
};

export const getDataSource = (dataSource: DATA_SOURCES) => {
  const defaultDataSource = merge(
    DATA_SOURCE_OPTIONS[DATA_SOURCES.BIG_QUERY],
    DATA_SOURCE_FORM[DATA_SOURCES.BIG_QUERY]
  );
  return ({
    [DATA_SOURCES.BIG_QUERY]: defaultDataSource,
  }[dataSource] || defaultDataSource) as typeof defaultDataSource;
};

export const getTemplates = () => {
  return Object.keys(TEMPLATE_OPTIONS).map((key) => ({
    ...TEMPLATE_OPTIONS[key],
    value: key,
  })) as (Omit<ButtonOption, 'guide' | 'disabled'> & {
    value: DEMO_TEMPLATES;
  })[];
};
