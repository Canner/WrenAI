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
  DialectSQL: any;
  JSON: any;
};

export type AdjustThreadResponseChartInput = {
  chartType: ChartType;
  color?: InputMaybe<Scalars['String']>;
  theta?: InputMaybe<Scalars['String']>;
  xAxis?: InputMaybe<Scalars['String']>;
  xOffset?: InputMaybe<Scalars['String']>;
  yAxis?: InputMaybe<Scalars['String']>;
};

export type AdjustThreadResponseInput = {
  sql?: InputMaybe<Scalars['String']>;
  sqlGenerationReasoning?: InputMaybe<Scalars['String']>;
  tables?: InputMaybe<Array<Scalars['String']>>;
};

export type AdjustmentTask = {
  __typename?: 'AdjustmentTask';
  error?: Maybe<Error>;
  invalidSql?: Maybe<Scalars['String']>;
  queryId?: Maybe<Scalars['String']>;
  sql?: Maybe<Scalars['String']>;
  status?: Maybe<AskingTaskStatus>;
  traceId?: Maybe<Scalars['String']>;
};

export type ApiHistoryFilterInput = {
  apiType?: InputMaybe<ApiType>;
  endDate?: InputMaybe<Scalars['String']>;
  projectId?: InputMaybe<Scalars['Int']>;
  startDate?: InputMaybe<Scalars['String']>;
  statusCode?: InputMaybe<Scalars['Int']>;
  threadId?: InputMaybe<Scalars['String']>;
};

export type ApiHistoryPaginatedResponse = {
  __typename?: 'ApiHistoryPaginatedResponse';
  hasMore: Scalars['Boolean'];
  items: Array<ApiHistoryResponse>;
  total: Scalars['Int'];
};

export type ApiHistoryPaginationInput = {
  limit: Scalars['Int'];
  offset: Scalars['Int'];
};

export type ApiHistoryResponse = {
  __typename?: 'ApiHistoryResponse';
  apiType: ApiType;
  createdAt: Scalars['String'];
  durationMs?: Maybe<Scalars['Int']>;
  headers?: Maybe<Scalars['JSON']>;
  id: Scalars['String'];
  projectId: Scalars['Int'];
  requestPayload?: Maybe<Scalars['JSON']>;
  responsePayload?: Maybe<Scalars['JSON']>;
  statusCode?: Maybe<Scalars['Int']>;
  threadId?: Maybe<Scalars['String']>;
  updatedAt: Scalars['String'];
};

export enum ApiType {
  ASK = 'ASK',
  CREATE_INSTRUCTION = 'CREATE_INSTRUCTION',
  CREATE_SQL_PAIR = 'CREATE_SQL_PAIR',
  DELETE_INSTRUCTION = 'DELETE_INSTRUCTION',
  DELETE_SQL_PAIR = 'DELETE_SQL_PAIR',
  GENERATE_SQL = 'GENERATE_SQL',
  GENERATE_SUMMARY = 'GENERATE_SUMMARY',
  GENERATE_VEGA_CHART = 'GENERATE_VEGA_CHART',
  GET_INSTRUCTIONS = 'GET_INSTRUCTIONS',
  GET_MODELS = 'GET_MODELS',
  GET_SQL_PAIRS = 'GET_SQL_PAIRS',
  RUN_SQL = 'RUN_SQL',
  STREAM_ASK = 'STREAM_ASK',
  STREAM_GENERATE_SQL = 'STREAM_GENERATE_SQL',
  UPDATE_INSTRUCTION = 'UPDATE_INSTRUCTION',
  UPDATE_SQL_PAIR = 'UPDATE_SQL_PAIR'
}

export type AskingTask = {
  __typename?: 'AskingTask';
  candidates: Array<ResultCandidate>;
  error?: Maybe<Error>;
  intentReasoning?: Maybe<Scalars['String']>;
  invalidSql?: Maybe<Scalars['String']>;
  queryId?: Maybe<Scalars['String']>;
  rephrasedQuestion?: Maybe<Scalars['String']>;
  retrievedTables?: Maybe<Array<Scalars['String']>>;
  sqlGenerationReasoning?: Maybe<Scalars['String']>;
  status: AskingTaskStatus;
  traceId?: Maybe<Scalars['String']>;
  type?: Maybe<AskingTaskType>;
};

export type AskingTaskInput = {
  question: Scalars['String'];
  threadId?: InputMaybe<Scalars['Int']>;
};

export enum AskingTaskStatus {
  CORRECTING = 'CORRECTING',
  FAILED = 'FAILED',
  FINISHED = 'FINISHED',
  GENERATING = 'GENERATING',
  PLANNING = 'PLANNING',
  SEARCHING = 'SEARCHING',
  STOPPED = 'STOPPED',
  UNDERSTANDING = 'UNDERSTANDING'
}

export enum AskingTaskType {
  GENERAL = 'GENERAL',
  MISLEADING_QUERY = 'MISLEADING_QUERY',
  TEXT_TO_SQL = 'TEXT_TO_SQL'
}

export enum CacheScheduleDayEnum {
  FRI = 'FRI',
  MON = 'MON',
  SAT = 'SAT',
  SUN = 'SUN',
  THU = 'THU',
  TUE = 'TUE',
  WED = 'WED'
}

export type CalculatedFieldInput = {
  diagram?: InputMaybe<Scalars['JSON']>;
  expression: Scalars['String'];
  lineage: Array<Scalars['Int']>;
  name: Scalars['String'];
};

export type CalculatedFieldValidationResponse = {
  __typename?: 'CalculatedFieldValidationResponse';
  message?: Maybe<Scalars['String']>;
  valid: Scalars['Boolean'];
};

export enum ChartTaskStatus {
  FAILED = 'FAILED',
  FETCHING = 'FETCHING',
  FINISHED = 'FINISHED',
  GENERATING = 'GENERATING',
  STOPPED = 'STOPPED'
}

export enum ChartType {
  AREA = 'AREA',
  BAR = 'BAR',
  GROUPED_BAR = 'GROUPED_BAR',
  LINE = 'LINE',
  MULTI_LINE = 'MULTI_LINE',
  PIE = 'PIE',
  STACKED_BAR = 'STACKED_BAR'
}

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

export type CreateCalculatedFieldInput = {
  expression: ExpressionName;
  lineage: Array<Scalars['Int']>;
  modelId: Scalars['Int'];
  name: Scalars['String'];
};

export type CreateDashboardItemInput = {
  itemType: DashboardItemType;
  responseId: Scalars['Int'];
};

export type CreateInstructionInput = {
  instruction: Scalars['String'];
  isDefault: Scalars['Boolean'];
  questions: Array<Scalars['String']>;
};

export type CreateModelInput = {
  fields: Array<Scalars['String']>;
  primaryKey?: InputMaybe<Scalars['String']>;
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

export type CreateSqlPairInput = {
  question: Scalars['String'];
  sql: Scalars['String'];
};

export type CreateThreadInput = {
  question?: InputMaybe<Scalars['String']>;
  sql?: InputMaybe<Scalars['String']>;
  taskId?: InputMaybe<Scalars['String']>;
};

export type CreateThreadResponseInput = {
  question?: InputMaybe<Scalars['String']>;
  sql?: InputMaybe<Scalars['String']>;
  taskId?: InputMaybe<Scalars['String']>;
};

export type CreateViewInput = {
  name: Scalars['String'];
  responseId: Scalars['Int'];
};

export type CustomFieldInput = {
  expression: Scalars['String'];
  name: Scalars['String'];
};

export type Dashboard = {
  __typename?: 'Dashboard';
  cacheEnabled: Scalars['Boolean'];
  id: Scalars['Int'];
  name: Scalars['String'];
  nextScheduledAt?: Maybe<Scalars['String']>;
  projectId: Scalars['Int'];
  scheduleCron?: Maybe<Scalars['String']>;
  scheduleFrequency?: Maybe<ScheduleFrequencyEnum>;
  scheduleTimezone?: Maybe<Scalars['String']>;
};

export type DashboardItem = {
  __typename?: 'DashboardItem';
  dashboardId: Scalars['Int'];
  detail: DashboardItemDetail;
  displayName?: Maybe<Scalars['String']>;
  id: Scalars['Int'];
  layout: DashboardItemLayout;
  type: DashboardItemType;
};

export type DashboardItemDetail = {
  __typename?: 'DashboardItemDetail';
  chartSchema?: Maybe<Scalars['JSON']>;
  sql: Scalars['String'];
};

export type DashboardItemLayout = {
  __typename?: 'DashboardItemLayout';
  h: Scalars['Int'];
  w: Scalars['Int'];
  x: Scalars['Int'];
  y: Scalars['Int'];
};

export enum DashboardItemType {
  AREA = 'AREA',
  BAR = 'BAR',
  GROUPED_BAR = 'GROUPED_BAR',
  LINE = 'LINE',
  MULTI_LINE = 'MULTI_LINE',
  NUMBER = 'NUMBER',
  PIE = 'PIE',
  STACKED_BAR = 'STACKED_BAR',
  TABLE = 'TABLE'
}

export type DashboardItemWhereInput = {
  id: Scalars['Int'];
};

export type DashboardSchedule = {
  __typename?: 'DashboardSchedule';
  cron?: Maybe<Scalars['String']>;
  day?: Maybe<CacheScheduleDayEnum>;
  frequency?: Maybe<ScheduleFrequencyEnum>;
  hour?: Maybe<Scalars['Int']>;
  minute?: Maybe<Scalars['Int']>;
  timezone?: Maybe<Scalars['String']>;
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
  ATHENA = 'ATHENA',
  BIG_QUERY = 'BIG_QUERY',
  CLICK_HOUSE = 'CLICK_HOUSE',
  DUCKDB = 'DUCKDB',
  MSSQL = 'MSSQL',
  MYSQL = 'MYSQL',
  ORACLE = 'ORACLE',
  POSTGRES = 'POSTGRES',
  REDSHIFT = 'REDSHIFT',
  SNOWFLAKE = 'SNOWFLAKE',
  TRINO = 'TRINO'
}

export type DeleteDashboardItemInput = {
  itemId: Scalars['Int'];
};

export type DetailStep = {
  __typename?: 'DetailStep';
  cteName?: Maybe<Scalars['String']>;
  sql: Scalars['String'];
  summary: Scalars['String'];
};

export type DetailedAffectedCalculatedFields = {
  __typename?: 'DetailedAffectedCalculatedFields';
  displayName: Scalars['String'];
  referenceName: Scalars['String'];
  type: Scalars['String'];
};

export type DetailedAffectedRelationships = {
  __typename?: 'DetailedAffectedRelationships';
  displayName: Scalars['String'];
  referenceName: Scalars['String'];
};

export type DetailedChangeColumn = {
  __typename?: 'DetailedChangeColumn';
  displayName: Scalars['String'];
  sourceColumnName: Scalars['String'];
  type: Scalars['String'];
};

export type DetailedChangeTable = {
  __typename?: 'DetailedChangeTable';
  calculatedFields: Array<DetailedAffectedCalculatedFields>;
  columns: Array<DetailedChangeColumn>;
  displayName: Scalars['String'];
  relationships: Array<DetailedAffectedRelationships>;
  sourceTableName: Scalars['String'];
};

export type DetailedColumn = {
  __typename?: 'DetailedColumn';
  displayName: Scalars['String'];
  isCalculated: Scalars['Boolean'];
  nestedColumns?: Maybe<Array<DetailedNestedColumn>>;
  notNull: Scalars['Boolean'];
  properties: Scalars['JSON'];
  referenceName: Scalars['String'];
  sourceColumnName: Scalars['String'];
  type?: Maybe<Scalars['String']>;
};

export type DetailedDashboard = {
  __typename?: 'DetailedDashboard';
  cacheEnabled: Scalars['Boolean'];
  description?: Maybe<Scalars['String']>;
  id: Scalars['Int'];
  items: Array<DashboardItem>;
  name: Scalars['String'];
  nextScheduledAt?: Maybe<Scalars['String']>;
  schedule?: Maybe<DashboardSchedule>;
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

export type DetailedNestedColumn = {
  __typename?: 'DetailedNestedColumn';
  columnPath: Array<Scalars['String']>;
  displayName: Scalars['String'];
  id: Scalars['Int'];
  properties?: Maybe<Scalars['JSON']>;
  referenceName: Scalars['String'];
  sourceColumnName: Scalars['String'];
  type?: Maybe<Scalars['String']>;
};

export type DetailedRelation = {
  __typename?: 'DetailedRelation';
  fromColumnId: Scalars['Int'];
  fromModelId: Scalars['Int'];
  name: Scalars['String'];
  properties: Scalars['JSON'];
  toColumnId: Scalars['Int'];
  toModelId: Scalars['Int'];
  type: RelationType;
};

export type DetailedThread = {
  __typename?: 'DetailedThread';
  id: Scalars['Int'];
  responses: Array<ThreadResponse>;
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
  refSql?: Maybe<Scalars['String']>;
  referenceName: Scalars['String'];
  refreshTime?: Maybe<Scalars['String']>;
  relationFields: Array<Maybe<DiagramModelRelationField>>;
  sourceTableName: Scalars['String'];
};

export type DiagramModelField = {
  __typename?: 'DiagramModelField';
  aggregation?: Maybe<Scalars['String']>;
  columnId: Scalars['Int'];
  description?: Maybe<Scalars['String']>;
  displayName: Scalars['String'];
  expression?: Maybe<Scalars['String']>;
  id: Scalars['String'];
  isPrimaryKey: Scalars['Boolean'];
  lineage?: Maybe<Array<Scalars['Int']>>;
  nestedFields?: Maybe<Array<DiagramModelNestedField>>;
  nodeType: NodeType;
  referenceName: Scalars['String'];
  type: Scalars['String'];
};

export type DiagramModelNestedField = {
  __typename?: 'DiagramModelNestedField';
  columnPath: Array<Scalars['String']>;
  description?: Maybe<Scalars['String']>;
  displayName: Scalars['String'];
  id: Scalars['String'];
  nestedColumnId: Scalars['Int'];
  referenceName: Scalars['String'];
  type: Scalars['String'];
};

export type DiagramModelRelationField = {
  __typename?: 'DiagramModelRelationField';
  description?: Maybe<Scalars['String']>;
  displayName: Scalars['String'];
  fromColumnDisplayName: Scalars['String'];
  fromColumnId: Scalars['Int'];
  fromColumnName: Scalars['String'];
  fromModelDisplayName: Scalars['String'];
  fromModelId: Scalars['Int'];
  fromModelName: Scalars['String'];
  id: Scalars['String'];
  nodeType: NodeType;
  referenceName: Scalars['String'];
  relationId: Scalars['Int'];
  toColumnDisplayName: Scalars['String'];
  toColumnId: Scalars['Int'];
  toColumnName: Scalars['String'];
  toModelDisplayName: Scalars['String'];
  toModelId: Scalars['Int'];
  toModelName: Scalars['String'];
  type: RelationType;
};

export type DiagramView = {
  __typename?: 'DiagramView';
  description?: Maybe<Scalars['String']>;
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
  description?: Maybe<Scalars['String']>;
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

export enum ExpressionName {
  ABS = 'ABS',
  AVG = 'AVG',
  CBRT = 'CBRT',
  CEIL = 'CEIL',
  CEILING = 'CEILING',
  COUNT = 'COUNT',
  COUNT_IF = 'COUNT_IF',
  EXP = 'EXP',
  FLOOR = 'FLOOR',
  LENGTH = 'LENGTH',
  LN = 'LN',
  LOG10 = 'LOG10',
  MAX = 'MAX',
  MIN = 'MIN',
  REVERSE = 'REVERSE',
  ROUND = 'ROUND',
  SIGN = 'SIGN',
  SUM = 'SUM'
}

export type FieldInfo = {
  __typename?: 'FieldInfo';
  displayName: Scalars['String'];
  expression?: Maybe<Scalars['String']>;
  id: Scalars['Int'];
  isCalculated: Scalars['Boolean'];
  nestedColumns?: Maybe<Array<NestedFieldInfo>>;
  notNull: Scalars['Boolean'];
  properties?: Maybe<Scalars['JSON']>;
  referenceName: Scalars['String'];
  sourceColumnName: Scalars['String'];
  type?: Maybe<Scalars['String']>;
};

export type GenerateQuestionInput = {
  sql: Scalars['String'];
};

export type GetMdlResult = {
  __typename?: 'GetMDLResult';
  hash: Scalars['String'];
  mdl?: Maybe<Scalars['String']>;
};

export type InstantRecommendedQuestionsInput = {
  previousQuestions?: InputMaybe<Array<Scalars['String']>>;
};

export type Instruction = {
  __typename?: 'Instruction';
  createdAt: Scalars['String'];
  id: Scalars['Int'];
  instruction: Scalars['String'];
  isDefault: Scalars['Boolean'];
  projectId: Scalars['Int'];
  questions: Array<Scalars['String']>;
  updatedAt: Scalars['String'];
};

export type InstructionWhereInput = {
  id: Scalars['Int'];
};

export type ItemLayoutInput = {
  h: Scalars['Int'];
  itemId: Scalars['Int'];
  w: Scalars['Int'];
  x: Scalars['Int'];
  y: Scalars['Int'];
};

export type LearningRecord = {
  __typename?: 'LearningRecord';
  paths: Array<Scalars['String']>;
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

export type ModelSubstituteInput = {
  sql: Scalars['DialectSQL'];
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
  adjustThreadResponse: ThreadResponse;
  adjustThreadResponseChart: ThreadResponse;
  cancelAdjustmentTask: Scalars['Boolean'];
  cancelAskingTask: Scalars['Boolean'];
  createAskingTask: Task;
  createCalculatedField: Scalars['JSON'];
  createDashboardItem: DashboardItem;
  createInstantRecommendedQuestions: Task;
  createInstruction: Instruction;
  createModel: Scalars['JSON'];
  createRelation: Scalars['JSON'];
  createSqlPair: SqlPair;
  createThread: Thread;
  createThreadResponse: ThreadResponse;
  createView: ViewInfo;
  deleteCalculatedField: Scalars['Boolean'];
  deleteDashboardItem: Scalars['Boolean'];
  deleteInstruction: Scalars['Boolean'];
  deleteModel: Scalars['Boolean'];
  deleteRelation: Scalars['Boolean'];
  deleteSqlPair: Scalars['Boolean'];
  deleteThread: Scalars['Boolean'];
  deleteView: Scalars['Boolean'];
  deploy: Scalars['JSON'];
  generateProjectRecommendationQuestions: Scalars['Boolean'];
  generateQuestion: Scalars['String'];
  generateThreadRecommendationQuestions: Scalars['Boolean'];
  generateThreadResponseAnswer: ThreadResponse;
  generateThreadResponseBreakdown: ThreadResponse;
  generateThreadResponseChart: ThreadResponse;
  modelSubstitute: Scalars['String'];
  previewBreakdownData: Scalars['JSON'];
  previewData: Scalars['JSON'];
  previewItemSQL: PreviewItemResponse;
  previewModelData: Scalars['JSON'];
  previewSql: Scalars['JSON'];
  previewViewData: Scalars['JSON'];
  rerunAdjustmentTask: Scalars['Boolean'];
  rerunAskingTask: Task;
  resetCurrentProject: Scalars['Boolean'];
  resolveSchemaChange: Scalars['Boolean'];
  saveDataSource: DataSource;
  saveLearningRecord: LearningRecord;
  saveRelations: Scalars['JSON'];
  saveTables: Scalars['JSON'];
  setDashboardSchedule: Dashboard;
  startSampleDataset: Scalars['JSON'];
  triggerDataSourceDetection: Scalars['Boolean'];
  updateCalculatedField: Scalars['JSON'];
  updateCurrentProject: Scalars['Boolean'];
  updateDashboardItem: DashboardItem;
  updateDashboardItemLayouts: Array<DashboardItem>;
  updateDataSource: DataSource;
  updateInstruction: Instruction;
  updateModel: Scalars['JSON'];
  updateModelMetadata: Scalars['Boolean'];
  updateRelation: Scalars['JSON'];
  updateSqlPair: SqlPair;
  updateThread: Thread;
  updateThreadResponse: ThreadResponse;
  updateViewMetadata: Scalars['Boolean'];
  validateCalculatedField: CalculatedFieldValidationResponse;
  validateView: ViewValidationResponse;
};


export type MutationAdjustThreadResponseArgs = {
  data: AdjustThreadResponseInput;
  responseId: Scalars['Int'];
};


export type MutationAdjustThreadResponseChartArgs = {
  data: AdjustThreadResponseChartInput;
  responseId: Scalars['Int'];
};


export type MutationCancelAdjustmentTaskArgs = {
  taskId: Scalars['String'];
};


export type MutationCancelAskingTaskArgs = {
  taskId: Scalars['String'];
};


export type MutationCreateAskingTaskArgs = {
  data: AskingTaskInput;
};


export type MutationCreateCalculatedFieldArgs = {
  data: CreateCalculatedFieldInput;
};


export type MutationCreateDashboardItemArgs = {
  data: CreateDashboardItemInput;
};


export type MutationCreateInstantRecommendedQuestionsArgs = {
  data: InstantRecommendedQuestionsInput;
};


export type MutationCreateInstructionArgs = {
  data: CreateInstructionInput;
};


export type MutationCreateModelArgs = {
  data: CreateModelInput;
};


export type MutationCreateRelationArgs = {
  data: RelationInput;
};


export type MutationCreateSqlPairArgs = {
  data: CreateSqlPairInput;
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


export type MutationDeleteCalculatedFieldArgs = {
  where?: InputMaybe<UpdateCalculatedFieldWhere>;
};


export type MutationDeleteDashboardItemArgs = {
  where: DashboardItemWhereInput;
};


export type MutationDeleteInstructionArgs = {
  where: InstructionWhereInput;
};


export type MutationDeleteModelArgs = {
  where: ModelWhereInput;
};


export type MutationDeleteRelationArgs = {
  where: WhereIdInput;
};


export type MutationDeleteSqlPairArgs = {
  where: SqlPairWhereUniqueInput;
};


export type MutationDeleteThreadArgs = {
  where: ThreadUniqueWhereInput;
};


export type MutationDeleteViewArgs = {
  where: ViewWhereUniqueInput;
};


export type MutationDeployArgs = {
  force?: InputMaybe<Scalars['Boolean']>;
};


export type MutationGenerateQuestionArgs = {
  data: GenerateQuestionInput;
};


export type MutationGenerateThreadRecommendationQuestionsArgs = {
  threadId: Scalars['Int'];
};


export type MutationGenerateThreadResponseAnswerArgs = {
  responseId: Scalars['Int'];
};


export type MutationGenerateThreadResponseBreakdownArgs = {
  responseId: Scalars['Int'];
};


export type MutationGenerateThreadResponseChartArgs = {
  responseId: Scalars['Int'];
};


export type MutationModelSubstituteArgs = {
  data: ModelSubstituteInput;
};


export type MutationPreviewBreakdownDataArgs = {
  where: PreviewDataInput;
};


export type MutationPreviewDataArgs = {
  where: PreviewDataInput;
};


export type MutationPreviewItemSqlArgs = {
  data: PreviewItemSqlInput;
};


export type MutationPreviewModelDataArgs = {
  where: WhereIdInput;
};


export type MutationPreviewSqlArgs = {
  data?: InputMaybe<PreviewSqlDataInput>;
};


export type MutationPreviewViewDataArgs = {
  where: PreviewViewDataInput;
};


export type MutationRerunAdjustmentTaskArgs = {
  responseId: Scalars['Int'];
};


export type MutationRerunAskingTaskArgs = {
  responseId: Scalars['Int'];
};


export type MutationResolveSchemaChangeArgs = {
  where: ResolveSchemaChangeWhereInput;
};


export type MutationSaveDataSourceArgs = {
  data: DataSourceInput;
};


export type MutationSaveLearningRecordArgs = {
  data: SaveLearningRecordInput;
};


export type MutationSaveRelationsArgs = {
  data: SaveRelationInput;
};


export type MutationSaveTablesArgs = {
  data: SaveTablesInput;
};


export type MutationSetDashboardScheduleArgs = {
  data: SetDashboardScheduleInput;
};


export type MutationStartSampleDatasetArgs = {
  data: SampleDatasetInput;
};


export type MutationUpdateCalculatedFieldArgs = {
  data: UpdateCalculatedFieldInput;
  where: UpdateCalculatedFieldWhere;
};


export type MutationUpdateCurrentProjectArgs = {
  data: UpdateCurrentProjectInput;
};


export type MutationUpdateDashboardItemArgs = {
  data: UpdateDashboardItemInput;
  where: DashboardItemWhereInput;
};


export type MutationUpdateDashboardItemLayoutsArgs = {
  data: UpdateDashboardItemLayoutsInput;
};


export type MutationUpdateDataSourceArgs = {
  data: UpdateDataSourceInput;
};


export type MutationUpdateInstructionArgs = {
  data: UpdateInstructionInput;
  where: InstructionWhereInput;
};


export type MutationUpdateModelArgs = {
  data: UpdateModelInput;
  where: ModelWhereInput;
};


export type MutationUpdateModelMetadataArgs = {
  data: UpdateModelMetadataInput;
  where: ModelWhereInput;
};


export type MutationUpdateRelationArgs = {
  data: UpdateRelationInput;
  where: WhereIdInput;
};


export type MutationUpdateSqlPairArgs = {
  data: UpdateSqlPairInput;
  where: SqlPairWhereUniqueInput;
};


export type MutationUpdateThreadArgs = {
  data: UpdateThreadInput;
  where: ThreadUniqueWhereInput;
};


export type MutationUpdateThreadResponseArgs = {
  data: UpdateThreadResponseInput;
  where: ThreadResponseUniqueWhereInput;
};


export type MutationUpdateViewMetadataArgs = {
  data: UpdateViewMetadataInput;
  where: ViewWhereUniqueInput;
};


export type MutationValidateCalculatedFieldArgs = {
  data: ValidateCalculatedFieldInput;
};


export type MutationValidateViewArgs = {
  data: ValidateViewInput;
};

export type NestedFieldInfo = {
  __typename?: 'NestedFieldInfo';
  columnPath: Array<Scalars['String']>;
  displayName: Scalars['String'];
  id: Scalars['Int'];
  properties: Scalars['JSON'];
  referenceName: Scalars['String'];
  sourceColumnName: Scalars['String'];
  type: Scalars['String'];
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
  limit?: InputMaybe<Scalars['Int']>;
  responseId: Scalars['Int'];
  stepIndex?: InputMaybe<Scalars['Int']>;
};

export type PreviewItemResponse = {
  __typename?: 'PreviewItemResponse';
  cacheCreatedAt?: Maybe<Scalars['String']>;
  cacheHit: Scalars['Boolean'];
  cacheOverrodeAt?: Maybe<Scalars['String']>;
  data: Scalars['JSON'];
  override: Scalars['Boolean'];
};

export type PreviewItemSqlInput = {
  itemId: Scalars['Int'];
  limit?: InputMaybe<Scalars['Int']>;
  refresh?: InputMaybe<Scalars['Boolean']>;
};

export type PreviewSqlDataInput = {
  dryRun?: InputMaybe<Scalars['Boolean']>;
  limit?: InputMaybe<Scalars['Int']>;
  projectId?: InputMaybe<Scalars['String']>;
  sql: Scalars['String'];
};

export type PreviewViewDataInput = {
  id: Scalars['Int'];
  limit?: InputMaybe<Scalars['Int']>;
};

export enum ProjectLanguage {
  AR = 'AR',
  DE = 'DE',
  EN = 'EN',
  ES = 'ES',
  FA_IR = 'FA_IR',
  FR = 'FR',
  IT = 'IT',
  JA = 'JA',
  KO = 'KO',
  NL = 'NL',
  PT = 'PT',
  RU = 'RU',
  ZH_CN = 'ZH_CN',
  ZH_TW = 'ZH_TW'
}

export type Query = {
  __typename?: 'Query';
  adjustmentTask?: Maybe<AdjustmentTask>;
  apiHistory: ApiHistoryPaginatedResponse;
  askingTask?: Maybe<AskingTask>;
  autoGenerateRelation: Array<RecommendRelations>;
  dashboard: DetailedDashboard;
  dashboardItems: Array<DashboardItem>;
  diagram: Diagram;
  getMDL: GetMdlResult;
  getProjectRecommendationQuestions: RecommendedQuestionsTask;
  getThreadRecommendationQuestions: RecommendedQuestionsTask;
  instantRecommendedQuestions: RecommendedQuestionsTask;
  instructions: Array<Maybe<Instruction>>;
  learningRecord: LearningRecord;
  listDataSourceTables: Array<CompactTable>;
  listModels: Array<ModelInfo>;
  listViews: Array<ViewInfo>;
  model: DetailedModel;
  modelSync: ModelSyncResponse;
  nativeSql: Scalars['String'];
  onboardingStatus: OnboardingStatusResponse;
  schemaChange: SchemaChange;
  settings: Settings;
  sqlPairs: Array<Maybe<SqlPair>>;
  suggestedQuestions: SuggestedQuestionResponse;
  thread: DetailedThread;
  threadResponse: ThreadResponse;
  threads: Array<Thread>;
  view: ViewInfo;
};


export type QueryAdjustmentTaskArgs = {
  taskId: Scalars['String'];
};


export type QueryApiHistoryArgs = {
  filter?: InputMaybe<ApiHistoryFilterInput>;
  pagination: ApiHistoryPaginationInput;
};


export type QueryAskingTaskArgs = {
  taskId: Scalars['String'];
};


export type QueryGetMdlArgs = {
  hash: Scalars['String'];
};


export type QueryGetThreadRecommendationQuestionsArgs = {
  threadId: Scalars['Int'];
};


export type QueryInstantRecommendedQuestionsArgs = {
  taskId: Scalars['String'];
};


export type QueryModelArgs = {
  where: ModelWhereInput;
};


export type QueryNativeSqlArgs = {
  responseId: Scalars['Int'];
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

export type RecommendRelations = {
  __typename?: 'RecommendRelations';
  displayName: Scalars['String'];
  id: Scalars['Int'];
  referenceName: Scalars['String'];
  relations: Array<Maybe<Relation>>;
};

export type RecommendedQuestionsTask = {
  __typename?: 'RecommendedQuestionsTask';
  error?: Maybe<Error>;
  questions: Array<ResultQuestion>;
  status: RecommendedQuestionsTaskStatus;
};

export enum RecommendedQuestionsTaskStatus {
  FAILED = 'FAILED',
  FINISHED = 'FINISHED',
  GENERATING = 'GENERATING',
  NOT_STARTED = 'NOT_STARTED'
}

export enum RedshiftConnectionType {
  redshift = 'redshift',
  redshift_iam = 'redshift_iam'
}

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

export type ResolveSchemaChangeWhereInput = {
  type: SchemaChangeType;
};

export type ResultCandidate = {
  __typename?: 'ResultCandidate';
  sql: Scalars['String'];
  sqlPair?: Maybe<SqlPair>;
  type: ResultCandidateType;
  view?: Maybe<ViewInfo>;
};

export enum ResultCandidateType {
  LLM = 'LLM',
  SQL_PAIR = 'SQL_PAIR',
  VIEW = 'VIEW'
}

export type ResultQuestion = {
  __typename?: 'ResultQuestion';
  category: Scalars['String'];
  question: Scalars['String'];
  sql: Scalars['String'];
};

export type SampleDatasetInput = {
  name: SampleDatasetName;
};

export enum SampleDatasetName {
  ECOMMERCE = 'ECOMMERCE',
  HR = 'HR',
  MUSIC = 'MUSIC',
  NBA = 'NBA'
}

export type SaveLearningRecordInput = {
  path: Scalars['String'];
};

export type SaveRelationInput = {
  relations: Array<InputMaybe<RelationInput>>;
};

export type SaveTablesInput = {
  tables: Array<Scalars['String']>;
};

export enum ScheduleFrequencyEnum {
  CUSTOM = 'CUSTOM',
  DAILY = 'DAILY',
  NEVER = 'NEVER',
  WEEKLY = 'WEEKLY'
}

export type SchemaChange = {
  __typename?: 'SchemaChange';
  deletedColumns?: Maybe<Array<DetailedChangeTable>>;
  deletedTables?: Maybe<Array<DetailedChangeTable>>;
  lastSchemaChangeTime?: Maybe<Scalars['String']>;
  modifiedColumns?: Maybe<Array<DetailedChangeTable>>;
};

export enum SchemaChangeType {
  DELETED_COLUMNS = 'DELETED_COLUMNS',
  DELETED_TABLES = 'DELETED_TABLES',
  MODIFIED_COLUMNS = 'MODIFIED_COLUMNS'
}

export type SetDashboardScheduleData = {
  cron?: InputMaybe<Scalars['String']>;
  day?: InputMaybe<CacheScheduleDayEnum>;
  frequency: ScheduleFrequencyEnum;
  hour?: InputMaybe<Scalars['Int']>;
  minute?: InputMaybe<Scalars['Int']>;
  timezone?: InputMaybe<Scalars['String']>;
};

export type SetDashboardScheduleInput = {
  cacheEnabled: Scalars['Boolean'];
  schedule?: InputMaybe<SetDashboardScheduleData>;
};

export type Settings = {
  __typename?: 'Settings';
  dataSource: DataSource;
  language: ProjectLanguage;
  productVersion: Scalars['String'];
};

export type SimpleMeasureInput = {
  isCalculated: Scalars['Boolean'];
  name: Scalars['String'];
  notNull: Scalars['Boolean'];
  properties: Scalars['JSON'];
  type: Scalars['String'];
};

export type SqlPair = {
  __typename?: 'SqlPair';
  createdAt?: Maybe<Scalars['String']>;
  id: Scalars['Int'];
  projectId: Scalars['Int'];
  question: Scalars['String'];
  sql: Scalars['String'];
  updatedAt?: Maybe<Scalars['String']>;
};

export type SqlPairWhereUniqueInput = {
  id: Scalars['Int'];
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
  summary: Scalars['String'];
};

export type ThreadResponse = {
  __typename?: 'ThreadResponse';
  adjustment?: Maybe<ThreadResponseAdjustment>;
  adjustmentTask?: Maybe<AdjustmentTask>;
  answerDetail?: Maybe<ThreadResponseAnswerDetail>;
  askingTask?: Maybe<AskingTask>;
  breakdownDetail?: Maybe<ThreadResponseBreakdownDetail>;
  chartDetail?: Maybe<ThreadResponseChartDetail>;
  id: Scalars['Int'];
  question: Scalars['String'];
  sql?: Maybe<Scalars['String']>;
  threadId: Scalars['Int'];
  view?: Maybe<ViewInfo>;
};

export type ThreadResponseAdjustment = {
  __typename?: 'ThreadResponseAdjustment';
  payload?: Maybe<Scalars['JSON']>;
  type: ThreadResponseAdjustmentType;
};

export enum ThreadResponseAdjustmentType {
  APPLY_SQL = 'APPLY_SQL',
  REASONING = 'REASONING'
}

export type ThreadResponseAnswerDetail = {
  __typename?: 'ThreadResponseAnswerDetail';
  content?: Maybe<Scalars['String']>;
  error?: Maybe<Error>;
  numRowsUsedInLLM?: Maybe<Scalars['Int']>;
  queryId?: Maybe<Scalars['String']>;
  status?: Maybe<ThreadResponseAnswerStatus>;
};

export enum ThreadResponseAnswerStatus {
  FAILED = 'FAILED',
  FETCHING_DATA = 'FETCHING_DATA',
  FINISHED = 'FINISHED',
  INTERRUPTED = 'INTERRUPTED',
  NOT_STARTED = 'NOT_STARTED',
  PREPROCESSING = 'PREPROCESSING',
  STREAMING = 'STREAMING'
}

export type ThreadResponseBreakdownDetail = {
  __typename?: 'ThreadResponseBreakdownDetail';
  description?: Maybe<Scalars['String']>;
  error?: Maybe<Error>;
  queryId?: Maybe<Scalars['String']>;
  status: AskingTaskStatus;
  steps?: Maybe<Array<DetailStep>>;
};

export type ThreadResponseChartDetail = {
  __typename?: 'ThreadResponseChartDetail';
  adjustment?: Maybe<Scalars['Boolean']>;
  chartSchema?: Maybe<Scalars['JSON']>;
  chartType?: Maybe<ChartType>;
  description?: Maybe<Scalars['String']>;
  error?: Maybe<Error>;
  queryId?: Maybe<Scalars['String']>;
  status: ChartTaskStatus;
};

export type ThreadResponseUniqueWhereInput = {
  id: Scalars['Int'];
};

export type ThreadUniqueWhereInput = {
  id: Scalars['Int'];
};

export type TimeGrainInput = {
  dateParts: Array<Scalars['String']>;
  name: Scalars['String'];
  refColumn: Scalars['String'];
};

export type UpdateCalculatedFieldInput = {
  expression: ExpressionName;
  lineage: Array<Scalars['Int']>;
  name: Scalars['String'];
};

export type UpdateCalculatedFieldMetadataInput = {
  description?: InputMaybe<Scalars['String']>;
  id: Scalars['Int'];
};

export type UpdateCalculatedFieldWhere = {
  id: Scalars['Int'];
};

export type UpdateColumnMetadataInput = {
  description?: InputMaybe<Scalars['String']>;
  displayName?: InputMaybe<Scalars['String']>;
  id: Scalars['Int'];
};

export type UpdateCurrentProjectInput = {
  language: ProjectLanguage;
};

export type UpdateDashboardItemInput = {
  displayName: Scalars['String'];
};

export type UpdateDashboardItemLayoutsInput = {
  layouts: Array<ItemLayoutInput>;
};

export type UpdateDataSourceInput = {
  properties: Scalars['JSON'];
};

export type UpdateInstructionInput = {
  instruction?: InputMaybe<Scalars['String']>;
  isDefault?: InputMaybe<Scalars['Boolean']>;
  questions?: InputMaybe<Array<Scalars['String']>>;
};

export type UpdateModelInput = {
  fields: Array<Scalars['String']>;
  primaryKey?: InputMaybe<Scalars['String']>;
};

export type UpdateModelMetadataInput = {
  calculatedFields?: InputMaybe<Array<UpdateCalculatedFieldMetadataInput>>;
  columns?: InputMaybe<Array<UpdateColumnMetadataInput>>;
  description?: InputMaybe<Scalars['String']>;
  displayName?: InputMaybe<Scalars['String']>;
  nestedColumns?: InputMaybe<Array<UpdateNestedColumnMetadataInput>>;
  relationships?: InputMaybe<Array<UpdateRelationshipMetadataInput>>;
};

export type UpdateNestedColumnMetadataInput = {
  description?: InputMaybe<Scalars['String']>;
  displayName?: InputMaybe<Scalars['String']>;
  id: Scalars['Int'];
};

export type UpdateRelationInput = {
  type: RelationType;
};

export type UpdateRelationshipMetadataInput = {
  description?: InputMaybe<Scalars['String']>;
  id: Scalars['Int'];
};

export type UpdateSqlPairInput = {
  question?: InputMaybe<Scalars['String']>;
  sql?: InputMaybe<Scalars['String']>;
};

export type UpdateThreadInput = {
  summary?: InputMaybe<Scalars['String']>;
};

export type UpdateThreadResponseInput = {
  sql?: InputMaybe<Scalars['String']>;
};

export type UpdateViewColumnMetadataInput = {
  description?: InputMaybe<Scalars['String']>;
  referenceName: Scalars['String'];
};

export type UpdateViewMetadataInput = {
  columns?: InputMaybe<Array<UpdateViewColumnMetadataInput>>;
  description?: InputMaybe<Scalars['String']>;
  displayName?: InputMaybe<Scalars['String']>;
};

export type ValidateCalculatedFieldInput = {
  columnId?: InputMaybe<Scalars['Int']>;
  modelId: Scalars['Int'];
  name: Scalars['String'];
};

export type ValidateViewInput = {
  name: Scalars['String'];
};

export type ViewInfo = {
  __typename?: 'ViewInfo';
  displayName: Scalars['String'];
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

export type WhereIdInput = {
  id: Scalars['Int'];
};
