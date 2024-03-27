import { v4 as uuidv4 } from 'uuid';
import { JOIN_TYPE, NODE_TYPE } from '@/utils/enum';
import { Relationship, ModelColumn, Model, Manifest } from '@/utils/data/type';

export class ModelData {
  public readonly nodeType: NODE_TYPE = NODE_TYPE.MODEL;

  public readonly id: number;
  public readonly displayName: string;
  public readonly referenceName: string;
  public readonly sourceTableName: string;
  public readonly description: string;
  public readonly refSql: string;
  public readonly cached: boolean;
  public readonly refreshTime: string;
  public readonly relations: RelationData[];
  public readonly properties: Model['properties'];

  public readonly columns: ModelColumnData[];
  public readonly fields: ModelColumnData[];
  public readonly relationFields: ModelColumnData[];
  public readonly calculatedFields: ModelColumnData[];

  constructor(model: Model, data: Manifest) {
    this.id = uuidv4();
    // TODO: this will redefine when API come out
    this.displayName = model.name;
    this.referenceName = model.name;
    this.sourceTableName = model.name;

    this.description = model?.description || '';
    this.refSql = model.refSql;
    this.cached = model.cached;
    this.refreshTime = model.refreshTime;
    this.relations = data.relationships
      .filter((relationship) =>
        relationship.models.includes(this.referenceName),
      )
      .map((relationship) => new RelationData(relationship));

    this.columns = model.columns.map(
      (column) => new ModelColumnData(column, model, this.relations),
    );
    this.fields = this.columns.filter(
      (column) => !column.isCalculated && !column.relation,
    );
    this.relationFields = this.columns.filter((column) => column.relation);
    this.calculatedFields = this.columns.filter(
      (column) => column.isCalculated && !column.relation,
    );
  }
}

export class ModelColumnData {
  public readonly id: string;
  public readonly displayName: string;
  public readonly referenceName: string;
  public readonly type: string;
  public readonly relation?: RelationData;
  public readonly expression?: string;
  public readonly isPrimaryKey: boolean;
  public readonly isCalculated: boolean;
  public readonly properties: ModelColumn['properties'];

  constructor(column: ModelColumn, model: Model, relations: RelationData[]) {
    this.id = uuidv4();
    // TODO: this will redefine when API come out
    this.displayName = column.name;
    this.referenceName = column.name;

    this.type = column.type;
    if (column?.relationship) {
      const relation = relations.find(
        (item) => item.referenceName === column?.relationship,
      );
      this.relation = relation;
    }
    if (column?.expression) {
      this.expression = column.expression;
    }
    this.isPrimaryKey = column.name === model.primaryKey;
    this.isCalculated = column.isCalculated;
  }
}

export class RelationData {
  public readonly id: string;
  public readonly displayName: string;
  public readonly referenceName: string;
  public readonly models: string[];
  public readonly joinType: JOIN_TYPE;
  public readonly condition: string;
  public readonly fromField: { model: string; field: string };
  public readonly toField: { model: string; field: string };
  public readonly properties: Relationship['properties'];

  constructor(relationship: Relationship) {
    this.id = uuidv4();
    // TODO: this will redefine when API come out
    this.displayName = relationship.name;
    this.referenceName = relationship.name;

    this.models = relationship.models;
    this.joinType = relationship.joinType;
    this.condition = relationship.condition;
    this.properties = relationship.properties;

    const [fromCondition, toCondition] = relationship.condition.split(' = ');
    const [fromModel, fromField] = fromCondition.split('.');
    const [toModel, toField] = toCondition.split('.');
    this.fromField = { model: fromModel, field: fromField };
    this.toField = { model: toModel, field: toField };
  }
}
