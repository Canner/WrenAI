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
import {
  CreateCalculatedFieldData,
  ExpressionName,
  UpdateCalculatedFieldData,
} from '../models';
import { IMDLService } from './mdlService';
import { IWrenEngineAdaptor } from '../adaptors/wrenEngineAdaptor';

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
  updateCalculatedField(
    data: UpdateCalculatedFieldData,
    id: number,
  ): Promise<ModelColumn>;
  generateReferenceName(data: any): string;
  validateCalculatedFieldNaming(
    name: string,
    modelId: number,
    columnId?: number,
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
  private mdlService: IMDLService;
  private wrenEngineAdaptor: IWrenEngineAdaptor;

  constructor({
    projectService,
    modelRepository,
    modelColumnRepository,
    relationRepository,
    viewRepository,
    mdlService,
    wrenEngineAdaptor,
  }: {
    projectService: IProjectService;
    modelRepository: IModelRepository;
    modelColumnRepository: IModelColumnRepository;
    relationRepository: IRelationRepository;
    viewRepository: IViewRepository;
    mdlService: IMDLService;
    wrenEngineAdaptor: IWrenEngineAdaptor;
  }) {
    this.projectService = projectService;
    this.modelRepository = modelRepository;
    this.modelColumnRepository = modelColumnRepository;
    this.relationRepository = relationRepository;
    this.viewRepository = viewRepository;
    this.mdlService = mdlService;
    this.wrenEngineAdaptor = wrenEngineAdaptor;
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
    const { valid, message } = await this.validateCalculatedFieldNaming(
      name,
      modelId,
    );
    logger.debug(
      `creating calculated field ${name} : validateCalculatedFieldNaming: ${valid}, ${message}`,
    );
    if (!valid) {
      throw new Error(message);
    }
    const canQuery = await this.checkCalculatedFieldCanQuery(
      modelId,
      model.referenceName,
      data,
    );
    logger.debug(
      `creating calculated field ${name} : checkCalculatedFieldCanQuery: ${canQuery}`,
    );
    if (!canQuery) {
      throw new Error(
        'Can not execute a query when using this calculated field',
      );
    }
    const inputFieldId = lineage[lineage.length - 1];
    const dataType = await this.inferCalculatedFieldDataType(
      expression,
      inputFieldId,
    );
    logger.debug(
      `creating calculated field ${name} : inferCalculatedFieldDataType: ${dataType}`,
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

  public async updateCalculatedField(
    data: UpdateCalculatedFieldData,
    id: number,
  ): Promise<ModelColumn> {
    const { name, expression, lineage } = data;
    const column = await this.modelColumnRepository.findOneBy({ id });
    if (!column) {
      throw new Error('Column not found');
    }
    const model = await this.modelRepository.findOneBy({
      id: column.modelId,
    });
    const { valid, message } = await this.validateCalculatedFieldNaming(
      name,
      column.modelId,
      id,
    );
    logger.debug(
      `updating calculated field: ${id} : validateCalculatedFieldNaming: ${valid}, ${message}`,
    );
    if (!valid) {
      throw new Error(message);
    }
    logger.debug({ id: model.id, modelName: model.referenceName, data });
    const canQuery = await this.checkCalculatedFieldCanQuery(
      model.id,
      model.referenceName,
      data,
    );
    logger.debug(
      `updating calculated field: ${id} :checkCalculatedFieldCanQuery: ${canQuery}`,
    );
    if (!canQuery) {
      throw new Error(
        'Can not execute a query when using this calculated field',
      );
    }
    const inputFieldId = lineage[lineage.length - 1];
    const dataType = await this.inferCalculatedFieldDataType(
      expression,
      inputFieldId,
    );
    logger.debug(
      `updating calculated field: ${id} :inferCalculatedFieldDataType: ${dataType}`,
    );
    const updatedColumn = await this.modelColumnRepository.updateOne(id, {
      displayName: name,
      sourceColumnName: name,
      referenceName: name,
      type: dataType,
      aggregation: expression,
      lineage: JSON.stringify(lineage),
    });
    return updatedColumn;
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

  public async validateCalculatedFieldNaming(
    name: string,
    modelId: number,
    columnId?: number,
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
    let existedColumns = await this.modelColumnRepository.findColumnsByModelIds(
      [modelId],
    );
    if (columnId) {
      existedColumns = existedColumns.filter(
        (column) => column.id !== columnId,
      );
    }
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
  Aggregations
    - **avg(***x***)** → double
    - **count(***x***)** → bigint
    - **max(***x***)** → [same as input]
    - **min(***x***)** → [same as input]
    - **sum(***x***)** → [same as input]
  Math functions
    - **abs(***x***)** → [same as input]
    - **cbrt(***x***)** → double
    - **ceil(***x***)** → [same as input]
    - **exp(***x***)** → double
    - **floor(***x***)** → [same as input]
    - **ln(***x***)** → double
    - **log10(***x***)** → double
    - **round(***x***)** → [same as input]
    - **sign(***x***)** → [same as input]

  String functions
    - **length(***string***)** → bigint
    - **reverse(**string**)** → varbinary
  */
  private async inferCalculatedFieldDataType(
    expression: ExpressionName,
    inputFieldId: number,
  ) {
    let type = null;
    switch (expression) {
      case ExpressionName.CEIL:
      case ExpressionName.FLOOR:
      case ExpressionName.ROUND:
      case ExpressionName.SIGN:
      case ExpressionName.SUM:
      case ExpressionName.MAX:
      case ExpressionName.MIN:
      case ExpressionName.ABS:
        type = await this.getFieldDataType(inputFieldId);
        break;
      case ExpressionName.CBRT:
      case ExpressionName.EXP:
      case ExpressionName.AVG:
      case ExpressionName.LN:
      case ExpressionName.LOG10:
        type = 'DOUBLE';
        break;
      case ExpressionName.COUNT:
      case ExpressionName.LENGTH:
        type = 'BIGINT';
        break;
      case ExpressionName.REVERSE:
        type = 'VARBINARY';
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

  private async checkCalculatedFieldCanQuery(
    modelId: number,
    modelName: string,
    data: CreateCalculatedFieldData | UpdateCalculatedFieldData,
  ) {
    const { mdlBuilder } = await this.mdlService.makeCurrentModelMDL();
    const { name: columnName, expression, lineage } = data;
    const inputFieldId = lineage[lineage.length - 1];
    const dataType = await this.inferCalculatedFieldDataType(
      expression,
      inputFieldId,
    );
    const modelColumn = {
      id: 99999999,
      modelId,
      displayName: columnName,
      sourceColumnName: columnName,
      referenceName: columnName,
      type: dataType,
      isCalculated: true,
      isPk: false,
      notNull: false,
      aggregation: expression,
      lineage: JSON.stringify(lineage),
      properties: JSON.stringify({ description: '' }),
    } as ModelColumn;
    mdlBuilder.insertCalculatedField(modelName, modelColumn);
    const manifest = mdlBuilder.getManifest();
    const { valid, message } =
      await this.wrenEngineAdaptor.validateColumnIsValid(
        manifest,
        modelName,
        columnName,
      );
    if (!valid) {
      logger.debug(`Calculated field can not query: ${message}`);
    }
    return valid;
  }
}
