export interface Manifest {
  catalog: string;
  schema: string;
  models: Model[];
  relationships: Relationship[];
  enumDefinitions: EnumDefinition[];
  metrics: Metric[];
  cumulativeMetrics: CumulativeMetric[];
  views: EnumDefinition[];
  macros: Macro[];
  dateSpine: DateSpine;
}

export interface CumulativeMetric {
  name: string;
  baseObject: string;
  measure: Measure;
  window: Window;
  cached: boolean;
  description?: string;
  properties: CumulativeMetricProperties;
}

export interface Measure {
  name: string;
  type: string;
  operator: string;
  refColumn: string;
  properties?: CumulativeMetricProperties;
}

export interface CumulativeMetricProperties {
  description?: string;
}

export interface Window {
  name: string;
  refColumn: string;
  timeUnit: string;
  start: Date;
  end: Date;
  properties: CumulativeMetricProperties;
}

export interface DateSpine {
  unit: string;
  start: Date;
  end: Date;
  properties: CumulativeMetricProperties;
}

export interface EnumDefinition {
  name: string;
  values?: Value[];
  description: string;
  properties: CumulativeMetricProperties;
  statement?: string;
}

export interface Value {
  name: string;
  value: string;
  properties: CumulativeMetricProperties;
}

export interface Macro {
  name: string;
  definition: string;
  properties: CumulativeMetricProperties;
}

export interface Metric {
  name: string;
  baseObject: string;
  dimension: Dimension[];
  measure: Dimension[];
  timeGrain: TimeGrain[];
  cached: boolean;
  refreshTime: string;
  description: string;
  properties: CumulativeMetricProperties;
}

export interface Dimension {
  name: string;
  type: string;
  isCalculated: boolean;
  notNull: boolean;
  properties: DimensionProperties;
}

export interface DimensionProperties {}

export interface TimeGrain {
  name: string;
  refColumn: string;
  dateParts: string[];
}

export interface Model {
  name: string;
  refSql: string;
  columns: Column[];
  primaryKey?: string;
  cached: boolean;
  refreshTime: string;
  description?: string;
  properties: CumulativeMetricProperties;
}

export interface createColumnInput {
  name: string;
}

export interface Column {
  name: string;
  type: string;
  isCalculated: boolean;
  notNull: boolean;
  description?: string;
  properties: CumulativeMetricProperties;
  relationship?: string;
  expression?: string;
}

export interface Relationship {
  name: string;
  models: string[];
  joinType: string;
  condition: string;
  manySideSortKeys: ManySideSortKey[];
  description: string;
  properties: CumulativeMetricProperties;
}

export interface ManySideSortKey {
  name: string;
  descending: boolean;
}
