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
