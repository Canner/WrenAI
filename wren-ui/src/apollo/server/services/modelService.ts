import { SampleDatasetTable } from '../data';
import {
  IModelColumnRepository,
  IModelRepository,
  IRelationRepository,
  IViewRepository,
  Model,
  ModelColumn,
  Relation,
} from '../repositories';
import { getLogger } from '@server/utils';
import { RelationData } from '../types';
import { IProjectService } from './projectService';
import { CreateCalculatedFieldData, ExpressionName } from '../models';

const logger = getLogger('ModelService');
logger.level = 'debug';

export interface ValidateCalculatedFieldResponse {
  valid: boolean;
  message?: string;
}

export interface IModelService {
  batchUpdateModelProperties(tables: SampleDatasetTable[]): Promise<void>;
  batchUpdateColumnProperties(tables: SampleDatasetTable[]): Promise<void>;
  saveRelations(relations: RelationData[]): Promise<Relation[]>;
  createCalculatedField(data: CreateCalculatedFieldData): Promise<ModelColumn>;
  generateReferenceName(data: any): string;
  validateCalculatedField(
    name: string,
    modelId: number,
  ): Promise<ValidateCalculatedFieldResponse>;
  deleteAllViewsByProjectId(projectId: number): Promise<void>;
  deleteAllModelsByProjectId(projectId: number): Promise<void>;
}

export interface GenerateReferenceNameData {
  displayName: string;
  sourceTableName: string;
  existedReferenceNames: string[];
}

export class ModelService implements IModelService {
  private projectService: IProjectService;
  private modelRepository: IModelRepository;
  private modelColumnRepository: IModelColumnRepository;
  private relationRepository: IRelationRepository;
  private viewRepository: IViewRepository;

  constructor({
    projectService,
    modelRepository,
    modelColumnRepository,
    relationRepository,
    viewRepository,
  }: {
    projectService: IProjectService;
    modelRepository: IModelRepository;
    modelColumnRepository: IModelColumnRepository;
    relationRepository: IRelationRepository;
    viewRepository: IViewRepository;
  }) {
    this.projectService = projectService;
    this.modelRepository = modelRepository;
    this.modelColumnRepository = modelColumnRepository;
    this.relationRepository = relationRepository;
    this.viewRepository = viewRepository;
  }

  public async createCalculatedField(
    data: CreateCalculatedFieldData,
  ): Promise<ModelColumn> {
    const { modelId, name, expression, lineage } = data;
    const model = await this.modelRepository.findOneBy({
      id: modelId,
    });
    if (!model) {
      throw new Error('Model not found');
    }
    const { valid, message } = await this.validateCalculatedField(
      name,
      modelId,
    );
    if (!valid) {
      throw new Error(message);
    }
    const inputFieldId = lineage[lineage.length - 1];
    const dataType = await this.inferCalculatedFieldDataType(
      expression,
      inputFieldId,
    );
    const column = await this.modelColumnRepository.createOne({
      modelId,
      displayName: name,
      sourceColumnName: name,
      referenceName: name,
      type: dataType,
      isCalculated: true,
      isPk: false,
      notNull: false,
      aggregation: expression,
      lineage: JSON.stringify(lineage),
      properties: JSON.stringify({ description: '' }),
    });
    return column;
  }

  public async batchUpdateModelProperties(tables: SampleDatasetTable[]) {
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
          ? { ...JSON.parse(model.properties), ...table.properties }
          : { ...table.properties };
        await this.modelRepository.updateOne(model.id, {
          properties: JSON.stringify(properties),
        });
      }),
    ]);
  }

  public async batchUpdateColumnProperties(tables: SampleDatasetTable[]) {
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
        if (!column.properties) {
          return;
        }
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
              ...column.properties,
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

  public async validateCalculatedField(
    name: string,
    modelId: number,
  ): Promise<ValidateCalculatedFieldResponse> {
    // only allow uppercase/lowercase english, numbers, underscore and dash
    const regex = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
    if (!regex.test(name)) {
      return {
        valid: false,
        message:
          'Only a-z, A-Z, 0-9, _, - are allowed and cannot start with number',
      };
    }

    // can not duplicated with existed column
    const existedColumns =
      await this.modelColumnRepository.findColumnsByModelIds([modelId]);
    if (existedColumns.find((column) => column.referenceName === name)) {
      return {
        valid: false,
        message: 'Calculated field name can not duplicated with existed column',
      };
    }
    return { valid: true };
  }

  public async deleteAllViewsByProjectId(projectId: number): Promise<void> {
    // delete all views
    await this.viewRepository.deleteAllBy({ projectId });
  }

  public async deleteAllModelsByProjectId(projectId: number): Promise<void> {
    // delete all relations
    await this.relationRepository.deleteAllBy({ projectId });

    // delete all models
    await this.modelRepository.deleteAllBy({ projectId });
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

  /** We currently support expression below, right side is the return type of the calculated field.
    abs(***x***)** → [same as input]
    max(***x***)** → [same as input]
    min(***x***)** → [same as input]
    sum(***x***)** → [same as input]
    ceiling(***x***)** → [same as input]
    floor(***x***)** → [same as input]
    ceil(***x***)** → [same as input]
    round(***x***)** → [same as input]
    sign(***x***)** → [same as input]
    ln(***x***)** → double
    exp(***x***)** → double
    cbrt(***x***)** → double
    avg(***x***)** → double
    log10(***x***)** → double
    count(***x***)** → bigint
    count_if(***x***)** → bigint
    length(***binary***)** → bigint
    reverse(***binary***)** → varbinary
  */
  private async inferCalculatedFieldDataType(
    expression: ExpressionName,
    inputFieldId: number,
  ) {
    let type = null;
    const project = await this.projectService.getCurrentProject();
    const dataSourceType = project.type;
    const usingPG = dataSourceType.toUpperCase() === 'POSTGRES';
    switch (expression) {
      case ExpressionName.AVG:
      case ExpressionName.CEIL:
      case ExpressionName.CEILING:
      case ExpressionName.COUNT:
      case ExpressionName.COUNT_IF:
      case ExpressionName.FLOOR:
      case ExpressionName.LOG10:
      case ExpressionName.ROUND:
      case ExpressionName.SIGN:
      case ExpressionName.SUM:
        type = await this.getFieldDataType(inputFieldId);
        break;
      case ExpressionName.ABS:
      case ExpressionName.CBRT:
      case ExpressionName.EXP:
      case ExpressionName.LN:
        type = usingPG ? 'double precision' : 'DOUBLE';
        break;
      case ExpressionName.LENGTH:
        type = usingPG ? 'bigint' : 'BIGINT';
        break;
      case ExpressionName.REVERSE:
        type = usingPG ? 'bytea' : 'VARBINARY';
        break;
      default:
        throw new Error('Unsupported expression');
    }
    return type;
  }

  private async getFieldDataType(fieldId: number): Promise<string> {
    const field = await this.modelColumnRepository.findOneBy({ id: fieldId });
    if (!field) {
      throw new Error('Field not found');
    }
    return field.type;
  }
}
