import {
  Model,
  ModelColumn,
  ModelNestedColumn,
  Project,
  RelationInfo,
  View,
} from '../repositories';
import { Manifest } from './type';

export interface MDLBuilderBuildFromOptions {
  project: Project;
  models: Model[];
  columns?: ModelColumn[];
  nestedColumns?: ModelNestedColumn[];
  relations?: RelationInfo[];
  views: View[];
  relatedModels?: Model[];
  relatedColumns?: ModelColumn[];
  relatedRelations?: RelationInfo[];
}

export interface IMDLBuilder {
  build(): Manifest;
}
