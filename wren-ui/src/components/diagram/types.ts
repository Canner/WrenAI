export enum JOIN_TYPE {
  MANY_TO_ONE = 'MANY_TO_ONE',
  ONE_TO_MANY = 'ONE_TO_MANY',
  ONE_TO_ONE = 'ONE_TO_ONE',
}

export enum METRIC_TYPE {
  DIMENSION = 'dimension',
  MEASURE = 'measure',
  TIME_GRAIN = 'timeGrain',
}

export enum NODE_TYPE {
  MODEL = 'model',
  METRIC = 'metric',
}

export enum MARKER_TYPE {
  MANY = 'many',
  ONE = 'one',
}

export enum EDGE_TYPE {
  STEP = 'step',
  SMOOTHSTEP = 'smoothstep',
  BEZIER = 'bezier',
  MODEL = 'model',
  METRIC = 'metric',
}

export interface PayloadData {
  catalog: string;
  schema: string;
  models: Model[];
  metrics: Metric[];
  relations: Relation[];
}

export interface Model {
  id: string;
  nodeType: NODE_TYPE | string;
  name: string;
  description?: string;
  refSql: string;
  cached: boolean;
  refreshTime: string;
  columns: ModelColumn[];
  fields: ModelColumn[];
  relationFields: ModelColumn[];
  calculatedFields: ModelColumn[];
  properties: Record<string, any>;
}

export interface ModelColumn {
  id: string;
  name: string;
  type: string;
  expression?: string;
  relation?: Relation;
  isPrimaryKey: boolean;
  isCalculated: boolean;
  properties: Record<string, any>;
}

export interface Relation {
  name: string;
  models: string[];
  joinType: JOIN_TYPE | string;
  condition: string;
  fromField: { model: string; field: string };
  toField: { model: string; field: string };
}

export type MetricColumn = {
  id: string;
  name: string;
  type: string;
  metricType: METRIC_TYPE | string;
  properties: Record<string, any>;
} & Partial<Dimension & Measure & TimeGrain>;

export interface Metric {
  id: string;
  nodeType: NODE_TYPE | string;
  name: string;
  description?: string;
  baseObject: string;
  cached: boolean;
  refreshTime: string;
  dimensions?: MetricColumn[];
  measures?: MetricColumn[];
  timeGrains?: MetricColumn[];
  windows?: MetricColumn[];
  properties: Record<string, any>;
}

export interface Dimension {
  name: string;
  type: string;
}

export interface Measure {
  name: string;
  type: string;
  expression: string;
}

export interface TimeGrain {
  name: string;
  refColumn: string;
  dateParts: string[];
}

export interface ClickPayload {
  title: string;
  data: Model | Metric;
}
