import { SampleDatasetTable } from '../data';
import {
  IModelColumnRepository,
  IModelRepository,
  IRelationRepository,
  Model,
  ModelColumn,
  Relation,
} from '../repositories';
import { getLogger } from '@server/utils';
import { RelationData } from '../types';
import { IProjectService } from './projectService';

const logger = getLogger('ModelService');
logger.level = 'debug';

export interface IModelService {
  batchUpdateModelDescription(tables: SampleDatasetTable[]): Promise<void>;
  batchUpdateColumnDescription(tables: SampleDatasetTable[]): Promise<void>;
  saveRelations(relations: RelationData[]): Promise<Relation[]>;
  generateReferenceName(data: any): string;
}

export interface GenerateReferenceNameData {
  displayName: string;
  sourceTableName: string;
  existedReferenceNames: string[];
}

export class ModelService implements IModelService {
  private projectService: any;
  private modelRepository: IModelRepository;
  private modelColumnRepository: any;
  private relationRepository: any;

  constructor({
    projectService,
    modelRepository,
    modelColumnRepository,
    relationRepository,
  }: {
    projectService: IProjectService;
    modelRepository: IModelRepository;
    modelColumnRepository: IModelColumnRepository;
    relationRepository: IRelationRepository;
  }) {
    this.projectService = projectService;
    this.modelRepository = modelRepository;
    this.modelColumnRepository = modelColumnRepository;
    this.relationRepository = relationRepository;
  }

  public async batchUpdateModelDescription(tables: SampleDatasetTable[]) {
    logger.debug('start batch update model description');
    const project = await this.projectService.getCurrentProject();
    const models = await this.modelRepository.findAllBy({
      projectId: project.id,
    });

    await Promise.all([
      tables.map(async (table) => {
        const model = models.find((m) => m.sourceTableName === table.tableName);
        if (!model) {
          logger.debug(`Model not found, table name: ${table.tableName}`);
          return;
        }
        const properties = model.properties
          ? { ...JSON.parse(model.properties), description: table.description }
          : { description: table.description };
        await this.modelRepository.updateOne(model.id, {
          properties: JSON.stringify(properties),
        });
      }),
    ]);
  }

  public async batchUpdateColumnDescription(tables: SampleDatasetTable[]) {
    logger.debug('start batch update column description');
    const project = await this.projectService.getCurrentProject();
    const models = await this.modelRepository.findAllBy({
      projectId: project.id,
    });
    const sourceColumns =
      (await this.modelColumnRepository.findColumnsByModelIds(
        models.map((m) => m.id),
      )) as ModelColumn[];
    const transformedColumns = tables.reduce((acc, table) => {
      const columns = table.columns?.map((column) => {
        return { ...column, tableName: table.tableName };
      });
      if (columns) {
        acc.push(...columns);
      }
      return acc;
    }, []);

    await Promise.all([
      transformedColumns.map(async (column) => {
        const model = models.find(
          (m) => m.sourceTableName === column.tableName,
        );
        const sourceColumn = sourceColumns.find(
          (sourceColumn) =>
            sourceColumn.modelId === model.id &&
            sourceColumn.sourceColumnName === column.name,
        );
        if (!sourceColumn) {
          logger.debug(
            `Column not found, table name: ${column.tableName}, column name: ${column.name}`,
          );
          return;
        }
        const properties = sourceColumn.properties
          ? {
              ...JSON.parse(sourceColumn.properties),
              description: column.description,
            }
          : { description: column.description };
        await this.modelColumnRepository.updateOne(sourceColumn.id, {
          properties: JSON.stringify(properties),
        });
      }),
    ]);
  }

  public generateReferenceName(data: GenerateReferenceNameData): string {
    const { sourceTableName, existedReferenceNames } = data;
    if (!existedReferenceNames.includes(sourceTableName)) {
      return sourceTableName;
    }
    return `${sourceTableName}_${existedReferenceNames.length + 1}`;
  }

  public async saveRelations(relations: RelationData[]) {
    const project = await this.projectService.getCurrentProject();

    const models = await this.modelRepository.findAllBy({
      projectId: project.id,
    });

    const columnIds = relations
      .map(({ fromColumnId, toColumnId }) => [fromColumnId, toColumnId])
      .flat();
    const columns =
      await this.modelColumnRepository.findColumnsByIds(columnIds);
    const relationValues = relations.map((relation) => {
      const fromColumn = columns.find(
        (column) => column.id === relation.fromColumnId,
      );
      if (!fromColumn) {
        throw new Error(`Column not found, column Id ${relation.fromColumnId}`);
      }
      const toColumn = columns.find(
        (column) => column.id === relation.toColumnId,
      );
      if (!toColumn) {
        throw new Error(`Column not found, column Id  ${relation.toColumnId}`);
      }
      const relationName = this.generateRelationName(relation, models);
      return {
        projectId: project.id,
        name: relationName,
        fromColumnId: relation.fromColumnId,
        toColumnId: relation.toColumnId,
        joinType: relation.type,
      } as Partial<Relation>;
    });

    const savedRelations = await Promise.all(
      relationValues.map((relation) =>
        this.relationRepository.createOne(relation),
      ),
    );
    return savedRelations;
  }

  private generateRelationName(relation: RelationData, models: Model[]) {
    const fromModel = models.find((m) => m.id === relation.fromModelId);
    const toModel = models.find((m) => m.id === relation.toModelId);
    if (!fromModel || !toModel) {
      throw new Error('Model not found');
    }
    return (
      fromModel.sourceTableName.charAt(0).toUpperCase() +
      fromModel.sourceTableName.slice(1) +
      toModel.sourceTableName.charAt(0).toUpperCase() +
      toModel.sourceTableName.slice(1)
    );
  }

  private async resetCurrentProjectModel(projectId) {
    const existsModels = await this.modelRepository.findAllBy({ projectId });
    const modelIds = existsModels.map((m) => m.id);
    await this.modelColumnRepository.deleteByModelIds(modelIds);
    await this.modelRepository.deleteMany(modelIds);
  }
}
