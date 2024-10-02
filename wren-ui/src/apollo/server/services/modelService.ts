import { SampleDatasetTable } from '@server/data';
import {
  IModelColumnRepository,
  IModelRepository,
  IRelationRepository,
  IViewRepository,
  Model,
  ModelColumn,
  Relation,
} from '@server/repositories';
import {
  getLogger,
  parseJson,
  replaceAllowableSyntax,
  validateDisplayName,
} from '@server/utils';
import { RelationData, UpdateRelationData } from '@server/types';
import { IProjectService } from './projectService';
import {
  CreateCalculatedFieldData,
  ExpressionName,
  UpdateCalculatedFieldData,
  CheckCalculatedFieldCanQueryData,
} from '@server/models';
import { IMDLService } from './mdlService';
import { IWrenEngineAdaptor } from '../adaptors/wrenEngineAdaptor';
import { ValidationRules } from '@server/adaptors/ibisAdaptor';
import { isEmpty, capitalize } from 'lodash';
import {} from '@server/utils/regex';
import * as Errors from '@server/utils/error';
import { DataSourceName } from '@server/types';
import { IQueryService } from './queryService';

const logger = getLogger('ModelService');
logger.level = 'debug';

export interface ValidateCalculatedFieldResponse {
  valid: boolean;
  message?: string;
}

export interface IModelService {
  updatePrimaryKeys(tables: SampleDatasetTable[]): Promise<void>;
  batchUpdateModelProperties(tables: SampleDatasetTable[]): Promise<void>;
  batchUpdateColumnProperties(tables: SampleDatasetTable[]): Promise<void>;
  // saveRelations was used in the onboarding process, we assume there is not existing relation in the project
  saveRelations(relations: RelationData[]): Promise<Relation[]>;
  createRelation(relation: RelationData): Promise<Relation>;
  updateRelation(relation: UpdateRelationData, id: number): Promise<Relation>;
  deleteRelation(id: number): Promise<void>;
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
  private queryService: IQueryService;

  constructor({
    projectService,
    modelRepository,
    modelColumnRepository,
    relationRepository,
    viewRepository,
    mdlService,
    wrenEngineAdaptor,
    queryService,
  }: {
    projectService: IProjectService;
    modelRepository: IModelRepository;
    modelColumnRepository: IModelColumnRepository;
    relationRepository: IRelationRepository;
    viewRepository: IViewRepository;
    mdlService: IMDLService;
    wrenEngineAdaptor: IWrenEngineAdaptor;
    queryService: IQueryService;
  }) {
    this.projectService = projectService;
    this.modelRepository = modelRepository;
    this.modelColumnRepository = modelColumnRepository;
    this.relationRepository = relationRepository;
    this.viewRepository = viewRepository;
    this.mdlService = mdlService;
    this.wrenEngineAdaptor = wrenEngineAdaptor;
    this.queryService = queryService;
  }

  public async createCalculatedField(
    data: CreateCalculatedFieldData,
  ): Promise<ModelColumn> {
    const { modelId, name: displayName, expression, lineage } = data;
    const logTitle = `Create Calculated Field ${displayName}`;
    const model = await this.modelRepository.findOneBy({
      id: modelId,
    });
    if (!model) {
      throw new Error('Model not found');
    }
    const { valid, message } = await this.validateCalculatedFieldNaming(
      displayName,
      modelId,
    );
    logger.debug(
      `${logTitle} : validateCalculatedFieldNaming: ${valid}, ${message}`,
    );
    if (!valid) {
      throw new Error(message);
    }

    // generate referenceName
    const referenceName =
      this.generateReferenceNameFromDisplayName(displayName);
    logger.debug(`${logTitle} : generated referenceName: "${referenceName}"`);

    // check this calculated field is valid for engine to query
    const { valid: canQuery, message: errorMessage } =
      await this.checkCalculatedFieldCanQuery(modelId, model.referenceName, {
        referenceName,
        expression,
        lineage,
      } as CheckCalculatedFieldCanQueryData);
    logger.debug(`${logTitle} : checkCalculatedFieldCanQuery: ${canQuery}`);
    if (!canQuery) {
      const parsedErrorMessage = parseJson(errorMessage);
      throw Errors.create(Errors.GeneralErrorCodes.INVALID_CALCULATED_FIELD, {
        customMessage: parsedErrorMessage?.message || errorMessage,
        originalError: parsedErrorMessage || null,
      });
    }
    const inputFieldId = lineage[lineage.length - 1];
    const dataType = await this.inferCalculatedFieldDataType(
      expression,
      inputFieldId,
    );
    logger.debug(`${logTitle} : inferCalculatedFieldDataType: ${dataType}`);

    // create calculated field
    const column = await this.modelColumnRepository.createOne({
      modelId,
      displayName: displayName,
      sourceColumnName: referenceName,
      referenceName,
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
    const { name: displayName, expression, lineage } = data;
    const logTitle = `Update Calculated Field ${id}`;
    const column = await this.modelColumnRepository.findOneBy({ id });
    if (!column) {
      throw new Error('Column not found');
    }
    const model = await this.modelRepository.findOneBy({
      id: column.modelId,
    });
    const { valid, message } = await this.validateCalculatedFieldNaming(
      displayName,
      column.modelId,
      id,
    );
    logger.debug(
      `${logTitle}: validateCalculatedFieldNaming: ${valid}, ${message}`,
    );
    if (!valid) {
      throw new Error(message);
    }
    const referenceName =
      this.generateReferenceNameFromDisplayName(displayName);
    logger.debug(`${logTitle}: generated referenceName: "${referenceName}"`);

    // check this calculated field is valid for engine to query
    const { valid: canQuery, message: errorMessage } =
      await this.checkCalculatedFieldCanQuery(model.id, model.referenceName, {
        referenceName,
        expression,
        lineage,
      } as CheckCalculatedFieldCanQueryData);
    logger.debug(`${logTitle}: checkCalculatedFieldCanQuery: ${canQuery}`);
    if (!canQuery) {
      const error = JSON.parse(errorMessage);
      throw Errors.create(Errors.GeneralErrorCodes.INVALID_CALCULATED_FIELD, {
        customMessage: error?.message,
        originalError: error,
      });
    }
    const inputFieldId = lineage[lineage.length - 1];
    const dataType = await this.inferCalculatedFieldDataType(
      expression,
      inputFieldId,
    );
    logger.debug(`${logTitle}: inferCalculatedFieldDataType: ${dataType}`);
    const updatedColumn = await this.modelColumnRepository.updateOne(id, {
      displayName: displayName,
      sourceColumnName: referenceName,
      referenceName,
      type: dataType,
      aggregation: expression,
      lineage: JSON.stringify(lineage),
    });
    return updatedColumn;
  }

  public async updatePrimaryKeys(tables: SampleDatasetTable[]) {
    logger.debug('start update primary keys');
    const { id } = await this.projectService.getCurrentProject();
    const models = await this.modelRepository.findAllBy({
      projectId: id,
    });
    const tableToUpdate = tables.filter((t) => t.primaryKey);
    for (const table of tableToUpdate) {
      const model = models.find((m) => m.sourceTableName === table.tableName);
      if (!model) {
        logger.debug(`Model not found, table name: ${table.tableName}`);
      }
      await this.modelColumnRepository.setModelPrimaryKey(
        model.id,
        table.primaryKey,
      );
    }
  }

  public async batchUpdateModelProperties(tables: SampleDatasetTable[]) {
    logger.debug('start batch update model description');
    const { id } = await this.projectService.getCurrentProject();
    const models = await this.modelRepository.findAllBy({
      projectId: id,
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
          displayName: table.properties?.displayName || model.displayName,
          properties: JSON.stringify(properties),
        });
      }),
    ]);
  }

  public async batchUpdateColumnProperties(tables: SampleDatasetTable[]) {
    logger.debug('start batch update column description');
    const { id } = await this.projectService.getCurrentProject();
    const models = await this.modelRepository.findAllBy({
      projectId: id,
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
    if (isEmpty(relations)) {
      return [];
    }
    const { id } = await this.projectService.getCurrentProject();

    const models = await this.modelRepository.findAllBy({
      projectId: id,
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
      const relationName = this.generateRelationName(relation, models, columns);
      return {
        projectId: id,
        name: relationName,
        fromColumnId: relation.fromColumnId,
        toColumnId: relation.toColumnId,
        joinType: relation.type,
        properties: relation.description
          ? JSON.stringify({ description: relation.description })
          : null,
      } as Partial<Relation>;
    });

    const savedRelations =
      await this.relationRepository.createMany(relationValues);

    return savedRelations;
  }

  public async createRelation(relation: RelationData): Promise<Relation> {
    const { id } = await this.projectService.getCurrentProject();
    const modelIds = [relation.fromModelId, relation.toModelId];
    const models = await this.modelRepository.findAllByIds(modelIds);
    const columnIds = [relation.fromColumnId, relation.toColumnId];
    const columns =
      await this.modelColumnRepository.findColumnsByIds(columnIds);

    const { valid, message } = await this.validateCreateRelation(
      models,
      columns,
      relation,
    );
    if (!valid) {
      throw new Error(message);
    }
    const relationName = this.generateRelationName(relation, models, columns);
    const savedRelation = await this.relationRepository.createOne({
      projectId: id,
      name: relationName,
      fromColumnId: relation.fromColumnId,
      toColumnId: relation.toColumnId,
      joinType: relation.type,
    });
    return savedRelation;
  }

  public async updateRelation(
    relation: UpdateRelationData,
    id: number,
  ): Promise<Relation> {
    const updatedRelation = await this.relationRepository.updateOne(id, {
      joinType: relation.type,
    });
    return updatedRelation;
  }

  public async deleteRelation(id: number): Promise<void> {
    const relation = await this.relationRepository.findOneBy({ id });
    if (!relation) {
      throw new Error('Relation not found');
    }
    const calculatedFields = await this.getCalculatedFieldByRelation(id);
    if (calculatedFields.length > 0) {
      // delete related calculated fields
      await this.modelColumnRepository.deleteMany(
        calculatedFields.map((f) => f.id),
      );
    }
    await this.relationRepository.deleteOne(id);
  }

  public async getCalculatedFieldByRelation(
    relationId: number,
  ): Promise<ModelColumn[]> {
    const calculatedFields = await this.modelColumnRepository.findAllBy({
      isCalculated: true,
    });
    const relatedCalculatedFields = calculatedFields.reduce((acc, field) => {
      const lineage = JSON.parse(field.lineage);
      const relationIds = lineage.slice(0, lineage.length - 1);
      if (relationIds.includes(relationId)) {
        acc.push(field);
      }
      return acc;
    }, []);
    return relatedCalculatedFields;
  }

  public async validateCalculatedFieldNaming(
    displayName: string,
    modelId: number,
    columnId?: number,
  ): Promise<ValidateCalculatedFieldResponse> {
    // only allow uppercase/lowercase english, numbers, syntaxes in the first raw of keyboard, {}, [], ', ", ,, .
    const validationRes = validateDisplayName(displayName);
    if (!validationRes.valid) {
      return {
        valid: false,
        message: validationRes.message || 'Invalid Calculated field name',
      };
    }

    // can not duplicated with existed column
    const referenceName =
      this.generateReferenceNameFromDisplayName(displayName);
    let existedColumns = await this.modelColumnRepository.findColumnsByModelIds(
      [modelId],
    );
    if (columnId) {
      existedColumns = existedColumns.filter(
        (column) => column.id !== columnId,
      );
    }
    if (
      existedColumns.find((column) => column.referenceName === referenceName)
    ) {
      return {
        valid: false,
        message: `The generated calculated field name "${referenceName}" is duplicated with existed column, please change the name and try again`,
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

  private generateReferenceNameFromDisplayName(displayName: string) {
    // replace all syntaxes that [in the first raw of keyboard, {}, [], ', ", ,, . ] with _
    return replaceAllowableSyntax(displayName);
  }

  private generateRelationName(
    relation: RelationData,
    models: Model[],
    columns: ModelColumn[],
  ) {
    const fromModel = models.find((m) => m.id === relation.fromModelId);
    const toModel = models.find((m) => m.id === relation.toModelId);
    if (!fromModel || !toModel) {
      throw new Error('Model not found');
    }

    const fromColumn = columns.find(
      (column) => column.id === relation.fromColumnId,
    );
    const toColumn = columns.find(
      (column) => column.id === relation.toColumnId,
    );

    return (
      capitalize(fromModel.sourceTableName) +
      capitalize(fromColumn.referenceName) +
      capitalize(toModel.sourceTableName) +
      capitalize(toColumn.referenceName)
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
    data: CheckCalculatedFieldCanQueryData,
  ) {
    const project = await this.projectService.getCurrentProject();
    const { mdlBuilder } = await this.mdlService.makeCurrentModelMDL();
    const { referenceName, expression, lineage } = data;
    const inputFieldId = lineage[lineage.length - 1];
    const dataType = await this.inferCalculatedFieldDataType(
      expression,
      inputFieldId,
    );

    // add temporary calculated field
    const modelColumn = {
      id: 99999999,
      modelId,
      displayName: referenceName,
      sourceColumnName: referenceName,
      referenceName: referenceName,
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

    // find the calculated field in manifest
    const calculatedField = manifest.models
      .find((m) => m.name === modelName)
      ?.columns.find((c) => c.name === referenceName);

    logger.debug(`Calculated field MDL: ${JSON.stringify(calculatedField)}`);

    // validate calculated field can query
    const dataSource = project.type;
    if (dataSource === DataSourceName.DUCKDB) {
      return await this.wrenEngineAdaptor.validateColumnIsValid(
        manifest,
        modelName,
        referenceName,
      );
    } else {
      const parameters = { modelName, columnName: referenceName };
      return await this.queryService.validate(
        project,
        ValidationRules.COLUMN_IS_VALID,
        manifest,
        parameters,
      );
    }
  }

  private async validateCreateRelation(
    models: Model[],
    columns: ModelColumn[],
    relation: RelationData,
  ) {
    const { fromModelId, fromColumnId, toModelId, toColumnId } = relation;
    const fromModel = models.find((m) => m.id === fromModelId);
    const toModel = models.find((m) => m.id === toModelId);
    // model should exist
    if (!fromModel) {
      return {
        valid: false,
        message: `Model not found: fromModelId ${fromModelId}`,
      };
    }
    if (!toModel) {
      return {
        valid: false,
        message: `Model not found: toModelId ${toModelId}`,
      };
    }
    // column should exist
    const fromColumn = columns.find((column) => column.id === fromColumnId);
    const toColumn = columns.find((column) => column.id === toColumnId);
    if (!fromColumn) {
      return {
        valid: false,
        message: `Column not found, column Id ${fromColumnId}`,
      };
    }
    if (!toColumn) {
      return {
        valid: false,
        message: `Column not found, column Id ${toColumnId}`,
      };
    }

    // column should belong to the model
    if (toColumn.modelId != toModelId) {
      return {
        valid: false,
        message: `Column not belong to the model, column Id ${toColumnId}`,
      };
    }
    if (fromColumn.modelId != fromModelId) {
      return {
        valid: false,
        message: `Column not belong to the model, column Id ${fromColumnId}`,
      };
    }

    const existedRelations =
      await this.relationRepository.findExistedRelationBetweenModels(relation);

    if (existedRelations.length > 0) {
      return {
        valid: false,
        message: 'This relationship already exists.',
      };
    }

    return { valid: true };
  }
}
