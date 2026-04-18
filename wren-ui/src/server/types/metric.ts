enum ModelType {
  TABLE = 'TABLE',
  METRIC = 'METRIC',
}

export type CreateSimpleMetricPayload = BaseMetricPaylod & {
  measure: SimpleMeasure[];
  dimension: Dimension[];
  timeGrain: TimeGrain[];
};

export type CreateCumulativeMetricPayload = BaseMetricPaylod & {
  measure: CumulativeMeasure[];
  window: Window;
};

interface BaseMetricPaylod {
  name: string;
  displayName: string;
  description: string;
  cached: boolean;
  refreshTime?: string;
  model: string;
  modelType: ModelType;
  properties: Properties;
}

interface SimpleMeasure {
  name: string;
  type: string;
  isCalculated: boolean;
  notNull: boolean;
  properties: Properties;
}

interface CumulativeMeasure {
  name: string;
  type: string;
  operator: string;
  refColumn: string;
  properties: Properties;
}

interface Dimension {
  name: string;
  type: string;
  isCalculated: boolean;
  notNull: boolean;
  properties: Properties;
}

interface TimeGrain {
  name: string;
  refColumn: string;
  dateParts: string[];
}

interface Window {
  name: string;
  refColumn: string;
  timeUnit: string;
  start: string;
  end: string;
  properties: Properties;
}

export interface Properties {}
