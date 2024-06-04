import { gql } from 'apollo-server-micro';

export const typeDefs = gql`
  scalar JSON

  enum DataSourceName {
    BIG_QUERY
    DUCKDB
    POSTGRES
  }

  enum ExpressionName {
    ABS
    AVG
    COUNT
    COUNT_IF
    MAX
    MIN
    SUM
    CBRT
    CEIL
    CEILING
    EXP
    FLOOR
    LN
    LOG10
    ROUND
    SIGN
    LENGTH
    REVERSE
  }

  enum SampleDatasetName {
    ECOMMERCE
    NBA
    MUSIC
  }

  enum SyncStatus {
    IN_PROGRESS
    SYNCRONIZED
    UNSYNCRONIZED
  }

  type DataSource {
    type: DataSourceName!
    properties: JSON!
    # Show the name if the data source setup comes from a sample
    sampleDataset: SampleDatasetName
  }

  input WhereIdInput {
    id: Int!
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
  }

  enum OnboardingStatus {
    NOT_STARTED
    DATASOURCE_SAVED
    ONBOARDING_FINISHED
    WITH_SAMPLE_DATASET
  }

  enum NodeType {
    MODEL
    METRIC
    VIEW
    RELATION
    FIELD
    CALCULATED_FIELD
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

  type RecommendRelations {
    id: Int!
    displayName: String!
    referenceName: String!
    relations: [Relation]!
  }

  input RelationInput {
    fromModelId: Int!
    fromColumnId: Int!
    toModelId: Int!
    toColumnId: Int!
    type: RelationType!
  }

  input UpdateRelationInput {
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
    sourceTableName: String!
    fields: [String!]!
    primaryKey: String
  }

  input CreateCalculatedFieldInput {
    modelId: Int!
    name: String!
    expression: ExpressionName!
    lineage: [Int!]!
  }

  input UpdateCalculatedFieldInput {
    name: String!
    expression: ExpressionName!
    lineage: [Int!]!
  }

  input UpdateCalculatedFieldWhere {
    id: Int!
  }

  input ValidateCalculatedFieldInput {
    name: String!
    modelId: Int!
    columnId: Int
  }

  type CalculatedFieldValidationResponse {
    valid: Boolean!
    message: String
  }

  input ModelWhereInput {
    id: Int!
  }

  input UpdateModelInput {
    fields: [String!]!
    primaryKey: String
  }

  # Metadata related
  input UpdateColumnMetadataInput {
    id: Int!
    displayName: String
    description: String
  }

  input UpdateCalculatedFieldMetadataInput {
    id: Int!
    description: String
  }

  input UpdateRelationshipMetadataInput {
    id: Int!
    description: String
  }

  input UpdateViewColumnMetadataInput {
    referenceName: String!
    description: String
  }

  input UpdateModelMetadataInput {
    displayName: String # Model display name, i,e, the alias of the model
    description: String # Model description
    columns: [UpdateColumnMetadataInput!] # Update column metadata
    calculatedFields: [UpdateCalculatedFieldMetadataInput!] # Update calculated field metadata
    relationships: [UpdateRelationshipMetadataInput!] # Update relationship metadata
  }

  input UpdateViewMetadataInput {
    displayName: String # View display name, i,e, the alias of the view
    description: String # View description
    columns: [UpdateViewColumnMetadataInput!]
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
    properties: JSON!
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

  # View
  type ViewInfo {
    id: Int!
    name: String!
    statement: String!
    displayName: String!
  }

  input ViewWhereUniqueInput {
    id: Int!
  }

  input CreateViewInput {
    name: String!
    responseId: Int!
  }

  input ValidateViewInput {
    name: String!
  }

  type ViewValidationResponse {
    valid: Boolean!
    message: String
  }

  # onboarding
  type OnboardingStatusResponse {
    status: OnboardingStatus
  }

  type ModelSyncResponse {
    status: SyncStatus!
  }

  type Diagram {
    models: [DiagramModel]!
    views: [DiagramView]!
  }

  type DiagramView {
    id: String!
    viewId: Int!
    nodeType: NodeType!
    statement: String!
    displayName: String!
    referenceName: String!
    fields: [DiagramViewField]!
    description: String
  }

  type DiagramViewField {
    id: String!
    displayName: String!
    referenceName: String!
    type: String!
    nodeType: NodeType!
    description: String
  }

  type DiagramModel {
    id: String!
    modelId: Int!
    nodeType: NodeType!
    displayName: String!
    referenceName: String!
    sourceTableName: String!
    refSql: String!
    cached: Boolean!
    refreshTime: String
    description: String
    fields: [DiagramModelField]!
    calculatedFields: [DiagramModelField]!
    relationFields: [DiagramModelRelationField]!
  }

  type DiagramModelField {
    id: String!
    columnId: Int!
    nodeType: NodeType!
    type: String!
    displayName: String!
    referenceName: String!
    description: String
    isPrimaryKey: Boolean!
    expression: String
    aggregation: String
    lineage: [Int!]
  }

  type DiagramModelRelationField {
    id: String!
    relationId: Int!
    nodeType: NodeType!
    type: RelationType!
    displayName: String!
    referenceName: String!
    description: String
    fromModelId: Int!
    fromModelName: String!
    fromModelDisplayName: String!
    fromColumnId: Int!
    fromColumnName: String!
    fromColumnDisplayName: String!
    toModelId: Int!
    toModelName: String!
    toModelDisplayName: String!
    toColumnId: Int!
    toColumnName: String!
    toColumnDisplayName: String!
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
    shortMessage: String
    message: String
    stacktrace: [String]
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

  enum ResultCandidateType {
    VIEW # View type candidate is provided basd on a saved view
    LLM # LLM type candidate is created by LLM
  }

  type ResultCandidate {
    type: ResultCandidateType!
    sql: String!
    summary: String!
    view: ViewInfo
  }

  type AskingTask {
    status: AskingTaskStatus!
    error: Error
    candidates: [ResultCandidate!]!
  }

  # Thread
  input CreateThreadInput {
    question: String
    sql: String
    summary: String
    viewId: Int
  }

  input CreateThreadResponseInput {
    question: String
    sql: String
    summary: String
    viewId: Int
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
    view: ViewInfo
    sql: String
    description: String
    steps: [DetailStep!]!
  }

  type ThreadResponse {
    id: Int!
    question: String!
    summary: String!
    status: AskingTaskStatus!
    detail: ThreadResponseDetail
    error: Error
  }

  # Thread only consists of basic information of a thread
  type Thread {
    id: Int!
    sql: String!
      @deprecated(
        reason: "Doesn't seem to be reasonable to put a sql in a thread"
      )
    summary: String!
  }

  # Detailed thread consists of thread and thread responses
  type DetailedThread {
    id: Int!
    sql: String!
      @deprecated(
        reason: "Doesn't seem to be reasonable to put a sql in a thread"
      )
    summary: String!
    responses: [ThreadResponse!]!
  }

  type SuggestedQuestion {
    question: String!
    label: String!
  }
  # Ask Questions Responses
  type SuggestedQuestionResponse {
    questions: [SuggestedQuestion]!
  }

  # SQL protocol connection information
  type ConnectionInfo {
    port: Int!
    database: String!
    schema: String!
    username: String
    password: String
  }

  # Settings
  input UpdateDataSourceInput {
    properties: JSON!
  }

  type Settings {
    productVersion: String!
    dataSource: DataSource!
  }

  # Query and Mutation
  type Query {
    # On Boarding Steps
    listDataSourceTables: [CompactTable!]!
    autoGenerateRelation: [RecommendRelations!]!
    onboardingStatus: OnboardingStatusResponse!

    # Modeling Page
    listModels: [ModelInfo!]!
    model(where: ModelWhereInput!): DetailedModel!
    modelSync: ModelSyncResponse!
    diagram: Diagram!

    # View
    listViews: [ViewInfo!]!
    view(where: ViewWhereUniqueInput!): ViewInfo!

    # Ask
    askingTask(taskId: String!): AskingTask!
    suggestedQuestions: SuggestedQuestionResponse!
    threads: [Thread!]!
    thread(threadId: Int!): DetailedThread!
    threadResponse(responseId: Int!): ThreadResponse!
    nativeSql(responseId: Int!): String!

    # Connection Info
    connectionInfo: ConnectionInfo!

    # Settings
    settings: Settings!
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
    previewModelData(where: WhereIdInput!): JSON!

    # Metadata
    updateModelMetadata(
      where: ModelWhereInput!
      data: UpdateModelMetadataInput!
    ): Boolean!
    updateViewMetadata(
      where: ViewWhereUniqueInput!
      data: UpdateViewMetadataInput!
    ): Boolean!

    # Relation
    createRelation(data: RelationInput!): JSON!
    updateRelation(data: UpdateRelationInput!, where: WhereIdInput!): JSON!
    deleteRelation(where: WhereIdInput!): Boolean!

    # Calculated field
    createCalculatedField(data: CreateCalculatedFieldInput!): JSON!
    updateCalculatedField(
      where: UpdateCalculatedFieldWhere!
      data: UpdateCalculatedFieldInput!
    ): JSON!
    deleteCalculatedField(where: UpdateCalculatedFieldWhere): Boolean!
    validateCalculatedField(
      data: ValidateCalculatedFieldInput!
    ): CalculatedFieldValidationResponse!

    # View
    createView(data: CreateViewInput!): ViewInfo!
    deleteView(where: ViewWhereUniqueInput!): Boolean!
    previewViewData(where: ViewWhereUniqueInput!): JSON!
    validateView(data: ValidateViewInput!): ViewValidationResponse!

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

    # Settings
    resetCurrentProject: Boolean!
    updateDataSource(data: UpdateDataSourceInput!): DataSource!
  }
`;
