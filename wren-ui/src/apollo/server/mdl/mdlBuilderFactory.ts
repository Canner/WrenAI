import { IMDLBuilder, MDLBuilder } from './mdlBuilder';
import {
  Model,
  ModelColumn,
  ModelNestedColumn,
  Project,
  RelationInfo,
  View,
} from '../repositories';
import { getConfig } from '@server/config';
import { FileMDLBuilder } from './fileMdlBuilder';

const config = getConfig();

export interface MDLBuilderFactoryOptions {
  project: Project;
  models: Model[];
  columns: ModelColumn[];
  nestedColumns: ModelNestedColumn[];
  relations: RelationInfo[];
  views: View[];
  relatedModels?: Model[];
  relatedColumns?: ModelColumn[];
  relatedRelations?: RelationInfo[];
}

export class MDLBuilderFactory {
  public static create(options: MDLBuilderFactoryOptions): IMDLBuilder {
    const {
      project,
      models,
      columns,
      nestedColumns,
      relations,
      views,
      relatedModels = models,
      relatedColumns = columns,
      relatedRelations = relations,
    } = options;

    if (config.mdlFilePath) {
      return new FileMDLBuilder();
    }

    return new MDLBuilder({
      project,
      models,
      columns,
      nestedColumns,
      relations,
      views,
      relatedModels,
      relatedColumns,
      relatedRelations,
    });
  }
}
