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

export type AskingTask = {
  __typename?: 'AskingTask';
  candidates: Array<ResultCandidate>;
  error?: Maybe<Error>;
  status: AskingTaskStatus;
};

export type AskingTaskInput = {
  question: Scalars['String'];
  threadId?: InputMaybe<Scalars['Int']>;
};

export enum AskingTaskStatus {
  FAILED = 'FAILED',
  FINISHED = 'FINISHED',
  GENERATING = 'GENERATING',
  SEARCHING = 'SEARCHING',
  STOPPED = 'STOPPED',
  UNDERSTANDING = 'UNDERSTANDING'
}

export type CalculatedFieldInput = {
  diagram?: InputMaybe<Scalars['JSON']>;
  expression: Scalars['String'];
  lineage: Array<Scalars['Int']>;
  name: Scalars['String'];
};

export type CompactColumn = {
  __typename?: 'CompactColumn';
  name: Scalars['String'];
  properties?: Maybe<Scalars['JSON']>;
  type: Scalars['String'];
};

export type CompactTable = {
  __typename?: 'CompactTable';
  columns: Array<CompactColumn>;
  name: Scalars['String'];
  properties?: Maybe<Scalars['JSON']>;
};

export type ConnectionInfo = {
  __typename?: 'ConnectionInfo';
  database: Scalars['String'];
  password?: Maybe<Scalars['String']>;
  port: Scalars['Int'];
  schema: Scalars['String'];
  username?: Maybe<Scalars['String']>;
};

export type CreateModelInput = {
  cached: Scalars['Boolean'];
  calculatedFields?: InputMaybe<Array<CalculatedFieldInput>>;
  description?: InputMaybe<Scalars['String']>;
  displayName: Scalars['String'];
  fields: Array<Scalars['String']>;
  refSql?: InputMaybe<Scalars['String']>;
  refreshTime?: InputMaybe<Scalars['String']>;
  sourceTableName: Scalars['String'];
};

export type CreateSimpleMetricInput = {
  cached: Scalars['Boolean'];
  description?: InputMaybe<Scalars['String']>;
  dimension: Array<DimensionInput>;
  displayName: Scalars['String'];
  measure: Array<SimpleMeasureInput>;
  model: Scalars['String'];
  name: Scalars['String'];
  properties: Scalars['JSON'];
  refreshTime?: InputMaybe<Scalars['String']>;
  timeGrain: Array<TimeGrainInput>;
};

export type CreateThreadInput = {
  question: Scalars['String'];
  sql: Scalars['String'];
  summary: Scalars['String'];
};

export type CreateThreadResponseInput = {
  question: Scalars['String'];
  sql: Scalars['String'];
  summary: Scalars['String'];
};

export type CreateViewInput = {
  name: Scalars['String'];
  responseId: Scalars['Int'];
};

export type CustomFieldInput = {
  expression: Scalars['String'];
  name: Scalars['String'];
};

export type DataSource = {
  __typename?: 'DataSource';
  properties: Scalars['JSON'];
  sampleDataset?: Maybe<SampleDatasetName>;
  type: DataSourceName;
};

export type DataSourceInput = {
  properties: Scalars['JSON'];
  type: DataSourceName;
};

export enum DataSourceName {
  BIG_QUERY = 'BIG_QUERY',
  DUCKDB = 'DUCKDB',
  POSTGRES = 'POSTGRES'
}

export type DetailStep = {
  __typename?: 'DetailStep';
  cteName?: Maybe<Scalars['String']>;
  sql: Scalars['String'];
  summary: Scalars['String'];
};

export type DetailedColumn = {
  __typename?: 'DetailedColumn';
  displayName: Scalars['String'];
  isCalculated: Scalars['Boolean'];
  notNull: Scalars['Boolean'];
  properties: Scalars['JSON'];
  referenceName: Scalars['String'];
  sourceColumnName: Scalars['String'];
  type?: Maybe<Scalars['String']>;
};

export type DetailedModel = {
  __typename?: 'DetailedModel';
  cached: Scalars['Boolean'];
  calculatedFields?: Maybe<Array<Maybe<DetailedColumn>>>;
  description?: Maybe<Scalars['String']>;
  displayName: Scalars['String'];
  fields?: Maybe<Array<Maybe<DetailedColumn>>>;
  primaryKey?: Maybe<Scalars['String']>;
  properties: Scalars['JSON'];
  refSql: Scalars['String'];
  referenceName: Scalars['String'];
  refreshTime?: Maybe<Scalars['String']>;
  relations?: Maybe<Array<Maybe<DetailedRelation>>>;
  sourceTableName: Scalars['String'];
};

export type DetailedRelation = {
  __typename?: 'DetailedRelation';
  fromColumnId: Scalars['Int'];
  fromModelId: Scalars['Int'];
  name: Scalars['String'];
  toColumnId: Scalars['Int'];
  toModelId: Scalars['Int'];
  type: RelationType;
};

export type DetailedThread = {
  __typename?: 'DetailedThread';
  id: Scalars['Int'];
  responses: Array<ThreadResponse>;
  sql: Scalars['String'];
  summary: Scalars['String'];
};

export type Diagram = {
  __typename?: 'Diagram';
  models: Array<Maybe<DiagramModel>>;
  views: Array<Maybe<DiagramView>>;
};

export type DiagramModel = {
  __typename?: 'DiagramModel';
  cached: Scalars['Boolean'];
  calculatedFields: Array<Maybe<DiagramModelField>>;
  description?: Maybe<Scalars['String']>;
  displayName: Scalars['String'];
  fields: Array<Maybe<DiagramModelField>>;
  id: Scalars['String'];
  modelId: Scalars['Int'];
  nodeType: NodeType;
  refSql: Scalars['String'];
  referenceName: Scalars['String'];
  refreshTime?: Maybe<Scalars['String']>;
  relationFields: Array<Maybe<DiagramModelRelationField>>;
  sourceTableName: Scalars['String'];
};

export type DiagramModelField = {
  __typename?: 'DiagramModelField';
  columnId: Scalars['Int'];
  description?: Maybe<Scalars['String']>;
  displayName: Scalars['String'];
  expression?: Maybe<Scalars['String']>;
  id: Scalars['String'];
  isPrimaryKey: Scalars['Boolean'];
  nodeType: NodeType;
  referenceName: Scalars['String'];
  type: Scalars['String'];
};

export type DiagramModelRelationField = {
  __typename?: 'DiagramModelRelationField';
  description?: Maybe<Scalars['String']>;
  displayName: Scalars['String'];
  fromColumnName: Scalars['String'];
  fromModelName: Scalars['String'];
  id: Scalars['String'];
  nodeType: NodeType;
  referenceName: Scalars['String'];
  relationId: Scalars['Int'];
  toColumnName: Scalars['String'];
  toModelName: Scalars['String'];
  type: RelationType;
};

export type DiagramView = {
  __typename?: 'DiagramView';
  displayName: Scalars['String'];
  fields: Array<Maybe<DiagramViewField>>;
  id: Scalars['String'];
  nodeType: NodeType;
  referenceName: Scalars['String'];
  statement: Scalars['String'];
  viewId: Scalars['Int'];
};

export type DiagramViewField = {
  __typename?: 'DiagramViewField';
  displayName: Scalars['String'];
  id: Scalars['String'];
  nodeType: NodeType;
  referenceName: Scalars['String'];
  type: Scalars['String'];
};

export type DimensionInput = {
  isCalculated: Scalars['Boolean'];
  name: Scalars['String'];
  notNull: Scalars['Boolean'];
  properties: Scalars['JSON'];
  type: Scalars['String'];
};

export type Error = {
  __typename?: 'Error';
  code?: Maybe<Scalars['String']>;
  message?: Maybe<Scalars['String']>;
  shortMessage?: Maybe<Scalars['String']>;
  stacktrace?: Maybe<Array<Maybe<Scalars['String']>>>;
};

export type FieldInfo = {
  __typename?: 'FieldInfo';
  displayName: Scalars['String'];
  expression?: Maybe<Scalars['String']>;
  id: Scalars['Int'];
  isCalculated: Scalars['Boolean'];
  notNull: Scalars['Boolean'];
  properties?: Maybe<Scalars['JSON']>;
  referenceName: Scalars['String'];
  sourceColumnName: Scalars['String'];
  type?: Maybe<Scalars['String']>;
};

export type MdlModelSubmitInput = {
  columns: Array<Scalars['String']>;
  name: Scalars['String'];
};

export type ModelInfo = {
  __typename?: 'ModelInfo';
  cached: Scalars['Boolean'];
  calculatedFields: Array<Maybe<FieldInfo>>;
  description?: Maybe<Scalars['String']>;
  displayName: Scalars['String'];
  fields: Array<Maybe<FieldInfo>>;
  id: Scalars['Int'];
  primaryKey?: Maybe<Scalars['String']>;
  properties?: Maybe<Scalars['JSON']>;
  refSql?: Maybe<Scalars['String']>;
  referenceName: Scalars['String'];
  refreshTime?: Maybe<Scalars['String']>;
  sourceTableName: Scalars['String'];
};

export type ModelSyncResponse = {
  __typename?: 'ModelSyncResponse';
  status: SyncStatus;
};

export type ModelWhereInput = {
  id: Scalars['Int'];
};

export type Mutation = {
  __typename?: 'Mutation';
  cancelAskingTask: Scalars['Boolean'];
  createAskingTask: Task;
  createModel: Scalars['JSON'];
  createThread: Thread;
  createThreadResponse: ThreadResponse;
  createView: ViewInfo;
  deleteModel: Scalars['Boolean'];
  deleteThread: Scalars['Boolean'];
  deleteView: Scalars['Boolean'];
  deploy: Scalars['JSON'];
  previewData: Scalars['JSON'];
  previewViewData: Scalars['JSON'];
  resetCurrentProject: Scalars['Boolean'];
  saveDataSource: DataSource;
  saveRelations: Scalars['JSON'];
  saveTables: Scalars['JSON'];
  startSampleDataset: Scalars['JSON'];
  updateDataSource: DataSource;
  updateModel: Scalars['JSON'];
  updateThread: Thread;
  validateView: ViewValidationResponse;
};


export type MutationCancelAskingTaskArgs = {
  taskId: Scalars['String'];
};


export type MutationCreateAskingTaskArgs = {
  data: AskingTaskInput;
};


export type MutationCreateModelArgs = {
  data: CreateModelInput;
};


export type MutationCreateThreadArgs = {
  data: CreateThreadInput;
};


export type MutationCreateThreadResponseArgs = {
  data: CreateThreadResponseInput;
  threadId: Scalars['Int'];
};


export type MutationCreateViewArgs = {
  data: CreateViewInput;
};


export type MutationDeleteModelArgs = {
  where: ModelWhereInput;
};


export type MutationDeleteThreadArgs = {
  where: ThreadUniqueWhereInput;
};


export type MutationDeleteViewArgs = {
  where: ViewWhereUniqueInput;
};


export type MutationPreviewDataArgs = {
  where: PreviewDataInput;
};


export type MutationPreviewViewDataArgs = {
  where: ViewWhereUniqueInput;
};


export type MutationSaveDataSourceArgs = {
  data: DataSourceInput;
};


export type MutationSaveRelationsArgs = {
  data: SaveRelationInput;
};


export type MutationSaveTablesArgs = {
  data: SaveTablesInput;
};


export type MutationStartSampleDatasetArgs = {
  data: SampleDatasetInput;
};


export type MutationUpdateDataSourceArgs = {
  data: UpdateDataSourceInput;
};


export type MutationUpdateModelArgs = {
  data: UpdateModelInput;
  where: ModelWhereInput;
};


export type MutationUpdateThreadArgs = {
  data: UpdateThreadInput;
  where: ThreadUniqueWhereInput;
};


export type MutationValidateViewArgs = {
  data: ValidateViewInput;
};

export enum NodeType {
  CALCULATED_FIELD = 'CALCULATED_FIELD',
  FIELD = 'FIELD',
  METRIC = 'METRIC',
  MODEL = 'MODEL',
  RELATION = 'RELATION',
  VIEW = 'VIEW'
}

export enum OnboardingStatus {
  DATASOURCE_SAVED = 'DATASOURCE_SAVED',
  NOT_STARTED = 'NOT_STARTED',
  ONBOARDING_FINISHED = 'ONBOARDING_FINISHED',
  WITH_SAMPLE_DATASET = 'WITH_SAMPLE_DATASET'
}

export type OnboardingStatusResponse = {
  __typename?: 'OnboardingStatusResponse';
  status?: Maybe<OnboardingStatus>;
};

export type PreviewDataInput = {
  responseId: Scalars['Int'];
  stepIndex?: InputMaybe<Scalars['Int']>;
};

export type Query = {
  __typename?: 'Query';
  askingTask: AskingTask;
  autoGenerateRelation?: Maybe<Array<RecommandRelations>>;
  connectionInfo: ConnectionInfo;
  diagram: Diagram;
  listDataSourceTables: Array<CompactTable>;
  listModels: Array<ModelInfo>;
  listViews: Array<ViewInfo>;
  model: DetailedModel;
  modelSync: ModelSyncResponse;
  onboardingStatus: OnboardingStatusResponse;
  settings: Settings;
  suggestedQuestions: SuggestedQuestionResponse;
  thread: DetailedThread;
  threadResponse: ThreadResponse;
  threads: Array<Thread>;
  view: ViewInfo;
};


export type QueryAskingTaskArgs = {
  taskId: Scalars['String'];
};


export type QueryModelArgs = {
  where: ModelWhereInput;
};


export type QueryThreadArgs = {
  threadId: Scalars['Int'];
};


export type QueryThreadResponseArgs = {
  responseId: Scalars['Int'];
};


export type QueryViewArgs = {
  where: ViewWhereUniqueInput;
};

export type RecommandRelations = {
  __typename?: 'RecommandRelations';
  id: Scalars['Int'];
  name: Scalars['String'];
  relations: Array<Maybe<Relation>>;
};

export type Relation = {
  __typename?: 'Relation';
  fromColumnId: Scalars['Int'];
  fromColumnReferenceName: Scalars['String'];
  fromModelId: Scalars['Int'];
  fromModelReferenceName: Scalars['String'];
  name: Scalars['String'];
  toColumnId: Scalars['Int'];
  toColumnReferenceName: Scalars['String'];
  toModelId: Scalars['Int'];
  toModelReferenceName: Scalars['String'];
  type: RelationType;
};

export type RelationInput = {
  fromColumnId: Scalars['Int'];
  fromModelId: Scalars['Int'];
  toColumnId: Scalars['Int'];
  toModelId: Scalars['Int'];
  type: RelationType;
};

export enum RelationType {
  MANY_TO_ONE = 'MANY_TO_ONE',
  ONE_TO_MANY = 'ONE_TO_MANY',
  ONE_TO_ONE = 'ONE_TO_ONE'
}

export type ResultCandidate = {
  __typename?: 'ResultCandidate';
  sql: Scalars['String'];
  summary: Scalars['String'];
};

export type SampleDatasetInput = {
  name: SampleDatasetName;
};

export enum SampleDatasetName {
  ECOMMERCE = 'ECOMMERCE',
  MUSIC = 'MUSIC',
  NBA = 'NBA'
}

export type SaveRelationInput = {
  relations: Array<InputMaybe<RelationInput>>;
};

export type SaveTablesInput = {
  tables: Array<Scalars['String']>;
};

export type Settings = {
  __typename?: 'Settings';
  dataSource: DataSource;
};

export type SimpleMeasureInput = {
  isCalculated: Scalars['Boolean'];
  name: Scalars['String'];
  notNull: Scalars['Boolean'];
  properties: Scalars['JSON'];
  type: Scalars['String'];
};

export type SuggestedQuestion = {
  __typename?: 'SuggestedQuestion';
  label: Scalars['String'];
  question: Scalars['String'];
};

export type SuggestedQuestionResponse = {
  __typename?: 'SuggestedQuestionResponse';
  questions: Array<Maybe<SuggestedQuestion>>;
};

export enum SyncStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  SYNCRONIZED = 'SYNCRONIZED',
  UNSYNCRONIZED = 'UNSYNCRONIZED'
}

export type Task = {
  __typename?: 'Task';
  id: Scalars['String'];
};

export type Thread = {
  __typename?: 'Thread';
  id: Scalars['Int'];
  sql: Scalars['String'];
  summary: Scalars['String'];
};

export type ThreadResponse = {
  __typename?: 'ThreadResponse';
  detail?: Maybe<ThreadResponseDetail>;
  error?: Maybe<Error>;
  id: Scalars['Int'];
  question: Scalars['String'];
  status: AskingTaskStatus;
};

export type ThreadResponseDetail = {
  __typename?: 'ThreadResponseDetail';
  description?: Maybe<Scalars['String']>;
  sql?: Maybe<Scalars['String']>;
  steps: Array<DetailStep>;
};

export type ThreadUniqueWhereInput = {
  id: Scalars['Int'];
};

export type TimeGrainInput = {
  dateParts: Array<Scalars['String']>;
  name: Scalars['String'];
  refColumn: Scalars['String'];
};

export type UpdateDataSourceInput = {
  properties: Scalars['JSON'];
};

export type UpdateModelInput = {
  cached: Scalars['Boolean'];
  calculatedFields?: InputMaybe<Array<CalculatedFieldInput>>;
  description?: InputMaybe<Scalars['String']>;
  displayName: Scalars['String'];
  fields: Array<Scalars['String']>;
  refreshTime?: InputMaybe<Scalars['String']>;
};

export type UpdateThreadInput = {
  summary?: InputMaybe<Scalars['String']>;
};

export type ValidateViewInput = {
  name: Scalars['String'];
};

export type ViewInfo = {
  __typename?: 'ViewInfo';
  id: Scalars['Int'];
  name: Scalars['String'];
  statement: Scalars['String'];
};

export type ViewValidationResponse = {
  __typename?: 'ViewValidationResponse';
  message?: Maybe<Scalars['String']>;
  valid: Scalars['Boolean'];
};

export type ViewWhereUniqueInput = {
  id: Scalars['Int'];
};
