import {
  Diagram as DiagramType,
  DiagramModel,
  DiagramModelField,
  DiagramModelRelationField,
} from '@/apollo/client/graphql/__types__';
export type {
  DiagramModel,
  DiagramModelField,
  DiagramModelRelationField,
} from '@/apollo/client/graphql/__types__';

// TODO: remove this when the backend implemented
export type Diagram = DiagramType & {
  views: any[];
};

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
