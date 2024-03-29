import { gql } from 'apollo-server-micro';

export const typeDefs = gql`
  scalar JSON

  enum DataSourceName {
    BIG_QUERY
    DUCKDB
  }

  enum SampleDatasetName {
    ECOMMERCE
    NBA
    MUSIC
  }

  type UsableDataSource {
    type: DataSourceName!
    requiredProperties: [String!]!
  }

  type DataSource {
    type: DataSourceName!
    properties: JSON!
  }

  input DataSourceInput {
    type: DataSourceName!
    properties: JSON!
  }

  input SampleDatasetInput {
    name: SampleDatasetName!
  }

  type CompactTable {
    name: String!
    columns: [CompactColumn!]!
    properties: JSON
  }

  input MDLModelSubmitInput {
    name: String!
    columns: [String!]!
  }

  enum RelationType {
    ONE_TO_ONE
    ONE_TO_MANY
    MANY_TO_ONE
    MANY_TO_MANY
  }

  enum OnboardingStatus {
    NOT_STARTED
    DATASOURCE_SAVED
    ONBOARDING_FINISHED
    WITH_SAMPLE_DATASET
  }

  type Relation {
    fromModelId: Int!
    fromModelReferenceName: String!
    fromColumnId: Int!
    fromColumnReferenceName: String!
    toModelId: Int!
    toModelReferenceName: String!
    toColumnId: Int!
    toColumnReferenceName: String!
    type: RelationType!
    name: String!
  }

  type RecommandRelations {
    name: String!
    id: Int!
    relations: [Relation]!
  }

  input RelationInput {
    fromModelId: Int!
    fromColumnId: Int!
    toModelId: Int!
    toColumnId: Int!
    type: RelationType!
  }

  input SaveRelationInput {
    relations: [RelationInput]!
  }

  input SaveTablesInput {
    tables: [String!]!
  }

  type CompactColumn {
    name: String!
    type: String!
    properties: JSON
  }

  input CustomFieldInput {
    name: String!
    expression: String!
  }

  input CalculatedFieldInput {
    name: String!
    expression: String!
    lineage: [Int!]!
    diagram: JSON
  }

  input CreateModelInput {
    displayName: String!
    sourceTableName: String!
    refSql: String
    description: String
    cached: Boolean!
    refreshTime: String
    fields: [String!]!
    calculatedFields: [CalculatedFieldInput!]
  }

  input ModelWhereInput {
    id: Int!
  }

  input UpdateModelInput {
    displayName: String!
    description: String
    cached: Boolean!
    refreshTime: String
    fields: [String!]!
    calculatedFields: [CalculatedFieldInput!]
  }

  type FieldInfo {
    id: Int!
    displayName: String!
    referenceName: String!
    sourceColumnName: String!
    type: String
    isCalculated: Boolean!
    notNull: Boolean!
    expression: String
    properties: JSON
  }

  type ModelInfo {
    id: Int!
    displayName: String!
    referenceName: String!
    sourceTableName: String!
    refSql: String
    primaryKey: String
    cached: Boolean!
    refreshTime: String
    description: String
    fields: [FieldInfo]!
    calculatedFields: [FieldInfo]!
    properties: JSON
  }

  type DetailedColumn {
    displayName: String!
    referenceName: String!
    sourceColumnName: String!
    type: String
    isCalculated: Boolean!
    notNull: Boolean!
    properties: JSON!
  }

  type DetailedRelation {
    fromModelId: Int!
    fromColumnId: Int!
    toModelId: Int!
    toColumnId: Int!
    type: RelationType!
    name: String!
  }

  type DetailedModel {
    displayName: String!
    referenceName: String!
    sourceTableName: String!
    refSql: String!
    primaryKey: String
    cached: Boolean!
    refreshTime: String
    description: String
    fields: [DetailedColumn]
    calculatedFields: [DetailedColumn]
    relations: [DetailedRelation]
    properties: JSON!
  }

  type OnboardingStatusResponse {
    status: OnboardingStatus
  }

  type ModelSyncResponse {
    isSyncronized: Boolean!
  }

  input SimpleMeasureInput {
    name: String!
    type: String!
    isCalculated: Boolean!
    notNull: Boolean!
    properties: JSON!
  }

  input DimensionInput {
    name: String!
    type: String!
    isCalculated: Boolean!
    notNull: Boolean!
    properties: JSON!
  }

  input TimeGrainInput {
    name: String!
    refColumn: String!
    dateParts: [String!]!
  }

  input CreateSimpleMetricInput {
    name: String!
    displayName: String!
    description: String
    cached: Boolean!
    refreshTime: String
    model: String!
    properties: JSON!
    measure: [SimpleMeasureInput!]!
    dimension: [DimensionInput!]!
    timeGrain: [TimeGrainInput!]!
  }

  # Task
  type Task {
    id: String!
  }

  # Error
  type Error {
    code: String
    message: String
  }

  # Asking Task
  input AskingTaskInput {
    question: String!
    # Used for follow-up questions
    threadId: Int
  }

  enum AskingTaskStatus {
    UNDERSTANDING
    SEARCHING
    GENERATING
    FINISHED
    FAILED
    STOPPED
  }

  type ResultCandidate {
    sql: String!
    summary: String!
  }

  type AskingTask {
    status: AskingTaskStatus!
    error: Error
    candidates: [ResultCandidate!]!
  }

  # Thread
  input CreateThreadInput {
    question: String!
    sql: String!
    summary: String!
  }

  input CreateThreadResponseInput {
    question: String!
    sql: String!
    summary: String!
  }

  input ThreadUniqueWhereInput {
    id: Int!
  }

  input UpdateThreadInput {
    summary: String
  }

  input PreviewDataInput {
    responseId: Int!
    # Optional, only used for preview data of a single step
    stepIndex: Int
  }

  type DetailStep {
    summary: String!
    sql: String!
    cteName: String
  }

  type ThreadResponseDetail {
    sql: String
    description: String
    steps: [DetailStep!]!
  }

  type ThreadResponse {
    id: Int!
    question: String!
    status: AskingTaskStatus!
    detail: ThreadResponseDetail
    error: Error
  }

  # Thread only consists of basic information of a thread
  type Thread {
    id: Int!
    sql: String!
    summary: String!
  }

  # Detailed thread consists of thread and thread responses
  type DetailedThread {
    id: Int!
    sql: String!
    summary: String!
    responses: [ThreadResponse!]!
  }

  # Query and Mutation
  type Query {
    # On Boarding Steps
    usableDataSource: [UsableDataSource!]!
    listDataSourceTables: [CompactTable!]!
    autoGenerateRelation: [RecommandRelations!]
    manifest: JSON!
    onboardingStatus: OnboardingStatusResponse!

    # Modeling Page
    listModels: [ModelInfo!]!
    model(where: ModelWhereInput!): DetailedModel!
    modelSync: ModelSyncResponse

    # Ask
    askingTask(taskId: String!): AskingTask!
    threads: [Thread!]!
    thread(threadId: Int!): DetailedThread!
    threadResponse(responseId: Int!): ThreadResponse!
  }

  type Mutation {
    # On Boarding Steps
    saveDataSource(data: DataSourceInput!): DataSource!
    startSampleDataset(data: SampleDatasetInput!): JSON!
    saveTables(data: SaveTablesInput!): JSON!
    saveRelations(data: SaveRelationInput!): JSON!
    deploy: JSON!

    # Modeling Page
    createModel(data: CreateModelInput!): JSON!
    updateModel(where: ModelWhereInput!, data: UpdateModelInput!): JSON!
    deleteModel(where: ModelWhereInput!): Boolean!

    # Ask
    createAskingTask(data: AskingTaskInput!): Task!
    cancelAskingTask(taskId: String!): Boolean!

    # Thread
    createThread(data: CreateThreadInput!): Thread!
    updateThread(
      where: ThreadUniqueWhereInput!
      data: UpdateThreadInput!
    ): Thread!
    deleteThread(where: ThreadUniqueWhereInput!): Boolean!

    # Thread Response
    createThreadResponse(
      threadId: Int!
      data: CreateThreadResponseInput!
    ): ThreadResponse!
    previewData(where: PreviewDataInput!): JSON!
  }
`;
