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

export type ComposeDiagram = (DiagramModel | DiagramView) &
  Partial<
    Pick<
      DiagramModel,
      | 'modelId'
      | 'calculatedFields'
      | 'relationFields'
      | 'refSql'
      | 'refreshTime'
      | 'cached'
      | 'sourceTableName'
    >
  > &
  Partial<Pick<DiagramView, 'viewId' | 'statement'>>;

export type ComposeDiagramField = (
  | DiagramModelField
  | DiagramModelRelationField
  | DiagramViewField
) &
  Partial<Pick<DiagramModel, 'description'>> &
  Partial<
    Pick<DiagramModelField, 'isPrimaryKey' | 'columnId' | 'nestedFields'>
  > &
  Partial<
    Pick<
      DiagramModelRelationField,
      | 'fromModelName'
      | 'fromModelDisplayName'
      | 'fromColumnName'
      | 'fromColumnDisplayName'
      | 'toModelName'
      | 'toModelDisplayName'
      | 'toColumnName'
      | 'toColumnDisplayName'
      | 'relationId'
    >
  >;

export type CachedProps = {
  cached: boolean;
  refreshTime?: string;
};
