import { JOIN_TYPE } from '@/utils/enum';
import {
  DiagramModel,
  DiagramModelField,
  DiagramModelRelationField,
} from '@/apollo/client/graphql/__types__';
export type {
  Diagram,
  DiagramModel,
  DiagramModelField,
  DiagramModelRelationField,
} from '@/apollo/client/graphql/__types__';

export type ComposeDiagram = DiagramModel;
export type ComposeDiagramField = (
  | DiagramModelField
  | DiagramModelRelationField
) &
  Partial<Pick<DiagramModelField, 'isPrimaryKey' | 'columnId'>> &
  Partial<
    Pick<
      DiagramModelRelationField,
      | 'fromModelName'
      | 'fromColumnName'
      | 'toModelName'
      | 'toColumnName'
      | 'relationId'
    >
  >;

export interface Manifest {
  catalog: string;
  schema: string;
  models: Model[];
  relationships: Relationship[];
  metrics: Metric[];
  cumulativeMetrics: Metric[];
  macros: Macro[];
  views: View[];
}

export interface View {
  name: string;
  statement: string;
  description: string;
  columns: ViewColumn[];
  // TODO: waiting to confirm cached available in view
  cached: boolean;
  refreshTime: string;
  properties: Record<string, any>;
}

// TODO: waiting to confirm view columns available
export interface ViewColumn {
  name: string;
  type: string;
  properties: Record<string, any>;
}

export interface Macro {
  name: string;
  definition: string;
  properties: Record<string, any>;
}

export interface Model {
  name: string;
  description?: string;
  refSql: string;
  columns: ModelColumn[];
  cached: boolean;
  refreshTime: string;
  primaryKey: string;
  properties: Record<string, any>;
}

export interface ModelColumn {
  name: string;
  type: string;
  isCalculated: boolean;
  notNull: boolean;
  properties: Record<string, any>;
  expression?: string;
  relationship?: string;
}

export interface Relationship {
  name: string;
  models: string[];
  joinType: JOIN_TYPE;
  condition: string;
  manySideSortKeys: {
    name: string;
    descending: boolean;
  }[];
  properties: Record<string, any>;
}

export type MetricColumn = Dimension & Measure & TimeGrain & Window;

export interface Metric {
  name: string;
  description?: string;
  baseObject: string;
  cached: boolean;
  refreshTime: string;
  properties: Record<string, any>;
  dimension?: Dimension[];
  measure?: Measure[];
  timeGrain?: TimeGrain[];
  window?: Window[];
}

export interface Dimension {
  name: string;
  type: string;
  isCalculated: boolean;
  properties: Record<string, any>;
}

export interface Measure {
  name: string;
  type: string;
  properties: Record<string, any>;
  refColumn?: string;
  operator?: string;
  isCalculated?: boolean;
  notNull?: boolean;
}

export interface TimeGrain {
  name: string;
  refColumn: string;
  dateParts: string[];
  properties: Record<string, any>;
}

export interface Window {
  name: string;
  refColumn: string;
  timeUnit: string;
  start: string;
  end: string;
  properties: Record<string, any>;
}
