import {
  DiagramModel,
  DiagramModelField,
  DiagramModelRelationField,
  DiagramView,
  DiagramViewField,
} from '@/apollo/client/graphql/__types__';
export type {
  Diagram,
  DiagramModel,
  DiagramModelField,
  DiagramModelRelationField,
  DiagramView,
} from '@/apollo/client/graphql/__types__';

export type ComposeDiagram = DiagramModel | DiagramView;

export type ComposeDiagramField = (
  | DiagramModelField
  | DiagramModelRelationField
  | DiagramViewField
) &
  Partial<Pick<DiagramModel, 'description'>> &
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

export type CachedProps = {
  cached: boolean;
  refreshTime?: string;
};
