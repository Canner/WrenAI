import { gql } from '@apollo/client';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
  JSON: any;
};

export type AutoGenerateInput = {
  tables: Array<Scalars['String']>;
};

export type CalculatedFieldInput = {
  expression: Scalars['String'];
  name: Scalars['String'];
};

export type CompactColumn = {
  __typename?: 'CompactColumn';
  name: Scalars['String'];
  type: Scalars['String'];
};

export type CompactModel = {
  __typename?: 'CompactModel';
  cached: Scalars['Boolean'];
  description?: Maybe<Scalars['String']>;
  name: Scalars['String'];
  primaryKey?: Maybe<Scalars['String']>;
  refSql: Scalars['String'];
  refreshTime: Scalars['String'];
};

export type CompactTable = {
  __typename?: 'CompactTable';
  columns: Array<CompactColumn>;
  name: Scalars['String'];
};

export type CreateModelInput = {
  cached: Scalars['Boolean'];
  calculatedFields?: InputMaybe<Array<CalculatedFieldInput>>;
  customFields?: InputMaybe<Array<CustomFieldInput>>;
  description?: InputMaybe<Scalars['String']>;
  displayName: Scalars['String'];
  fields: Array<Scalars['String']>;
  refreshTime?: InputMaybe<Scalars['String']>;
  tableName: Scalars['String'];
  type: ModelType;
};

export type CreateSimpleMetricInput = {
  cached: Scalars['Boolean'];
  description?: InputMaybe<Scalars['String']>;
  dimension: Array<DimensionInput>;
  displayName: Scalars['String'];
  measure: Array<SimpleMeasureInput>;
  model: Scalars['String'];
  modelType: ModelType;
  name: Scalars['String'];
  properties: Scalars['JSON'];
  refreshTime?: InputMaybe<Scalars['String']>;
  timeGrain: Array<TimeGrainInput>;
};

export type CustomFieldInput = {
  expression: Scalars['String'];
  name: Scalars['String'];
};

export type DataSource = {
  __typename?: 'DataSource';
  properties: Scalars['JSON'];
  type: DataSourceName;
};

export type DataSourceInput = {
  properties: Scalars['JSON'];
  type: DataSourceName;
};

export enum DataSourceName {
  BigQuery = 'BIG_QUERY'
}

export type DetailedColumn = {
  __typename?: 'DetailedColumn';
  isCalculated: Scalars['Boolean'];
  name: Scalars['String'];
  notNull: Scalars['Boolean'];
  properties: Scalars['JSON'];
  type: Scalars['String'];
};

export type DetailedModel = {
  __typename?: 'DetailedModel';
  cached: Scalars['Boolean'];
  columns: Array<DetailedColumn>;
  description?: Maybe<Scalars['String']>;
  name: Scalars['String'];
  primaryKey?: Maybe<Scalars['String']>;
  properties: Scalars['JSON'];
  refSql: Scalars['String'];
  refreshTime: Scalars['String'];
};

export type DimensionInput = {
  isCalculated: Scalars['Boolean'];
  name: Scalars['String'];
  notNull: Scalars['Boolean'];
  properties: Scalars['JSON'];
  type: Scalars['String'];
};

export type MdlInput = {
  models: Array<MdlModelSubmitInput>;
  relations: Array<RelationInput>;
};

export type MdlModelSubmitInput = {
  columns: Array<Scalars['String']>;
  name: Scalars['String'];
};

export enum ModelType {
  Custom = 'CUSTOM',
  Table = 'TABLE'
}

export type ModelWhereInput = {
  name: Scalars['String'];
};

export type Mutation = {
  __typename?: 'Mutation';
  createModel: Scalars['JSON'];
  deleteModel: Scalars['Boolean'];
  saveDataSource: DataSource;
  saveMDL: Scalars['JSON'];
  updateModel: Scalars['JSON'];
};


export type MutationCreateModelArgs = {
  data: CreateModelInput;
};


export type MutationDeleteModelArgs = {
  where: ModelWhereInput;
};


export type MutationSaveDataSourceArgs = {
  data: DataSourceInput;
};


export type MutationSaveMdlArgs = {
  data: MdlInput;
};


export type MutationUpdateModelArgs = {
  data: UpdateModelInput;
  where: ModelWhereInput;
};

export type Query = {
  __typename?: 'Query';
  autoGenerateRelation: Array<Relation>;
  getModel: DetailedModel;
  listDataSourceTables: Array<CompactTable>;
  listModels: Array<CompactModel>;
  manifest: Scalars['JSON'];
  usableDataSource: Array<UsableDataSource>;
};


export type QueryAutoGenerateRelationArgs = {
  where?: InputMaybe<AutoGenerateInput>;
};


export type QueryGetModelArgs = {
  where: ModelWhereInput;
};

export type Relation = {
  __typename?: 'Relation';
  from: RelationColumnInformation;
  to: RelationColumnInformation;
  type: RelationType;
};

export type RelationColumnInformation = {
  __typename?: 'RelationColumnInformation';
  columnName: Scalars['String'];
  tableName: Scalars['String'];
};

export type RelationColumnInformationInput = {
  columnName: Scalars['String'];
  tableName: Scalars['String'];
};

export type RelationInput = {
  from: RelationColumnInformationInput;
  to: RelationColumnInformationInput;
  type: RelationType;
};

export enum RelationType {
  ManyToMany = 'MANY_TO_MANY',
  ManyToOne = 'MANY_TO_ONE',
  OneToMany = 'ONE_TO_MANY',
  OneToOne = 'ONE_TO_ONE'
}

export type SimpleMeasureInput = {
  isCalculated: Scalars['Boolean'];
  name: Scalars['String'];
  notNull: Scalars['Boolean'];
  properties: Scalars['JSON'];
  type: Scalars['String'];
};

export type TimeGrainInput = {
  dateParts: Array<Scalars['String']>;
  name: Scalars['String'];
  refColumn: Scalars['String'];
};

export type UpdateModelInput = {
  cached: Scalars['Boolean'];
  calculatedFields?: InputMaybe<Array<CalculatedFieldInput>>;
  customFields?: InputMaybe<Array<CustomFieldInput>>;
  description?: InputMaybe<Scalars['String']>;
  displayName: Scalars['String'];
  fields: Array<Scalars['String']>;
  refreshTime?: InputMaybe<Scalars['String']>;
  type: ModelType;
};

export type UsableDataSource = {
  __typename?: 'UsableDataSource';
  requiredProperties: Array<Scalars['String']>;
  type: DataSourceName;
};
