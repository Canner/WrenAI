import GraphQLJSON from 'graphql-type-json';
import { ProjectResolver } from './resolvers/projectResolver';
import { ModelResolver } from './resolvers/modelResolver';
import { AskingResolver } from './resolvers/askingResolver';
import { DiagramResolver } from './resolvers/diagramResolver';
import { ConnectionInfoResolver } from './resolvers/connectionInfoResolver';

const projectResolver = new ProjectResolver();
const modelResolver = new ModelResolver();
const askingResolver = new AskingResolver();
const diagramResolver = new DiagramResolver();
const connectionInfoResolver = new ConnectionInfoResolver();

const resolvers = {
  JSON: GraphQLJSON,
  Query: {
    listDataSourceTables: projectResolver.listDataSourceTables,
    autoGenerateRelation: projectResolver.autoGenerateRelation,
    listModels: modelResolver.listModels,
    model: modelResolver.getModel,
    onboardingStatus: projectResolver.getOnboardingStatus,
    modelSync: modelResolver.checkModelSync,
    diagram: diagramResolver.getDiagram,

    // Ask
    askingTask: askingResolver.getAskingTask,
    suggestedQuestions: askingResolver.getSuggestedQuestions,

    // Thread
    thread: askingResolver.getThread,
    threads: askingResolver.listThreads,
    threadResponse: askingResolver.getResponse,

    // Views
    listViews: modelResolver.listViews,
    view: modelResolver.getView,

    // Connection Info
    connectionInfo: connectionInfoResolver.connectionInfo,
  },
  Mutation: {
    deploy: modelResolver.deploy,
    saveDataSource: projectResolver.saveDataSource,
    startSampleDataset: projectResolver.startSampleDataset,
    saveTables: projectResolver.saveTables,
    saveRelations: projectResolver.saveRelations,
    createModel: modelResolver.createModel,
    deleteModel: modelResolver.deleteModel,

    // Ask
    createAskingTask: askingResolver.createAskingTask,
    cancelAskingTask: askingResolver.cancelAskingTask,

    // Thread
    createThread: askingResolver.createThread,
    updateThread: askingResolver.updateThread,
    deleteThread: askingResolver.deleteThread,
    createThreadResponse: askingResolver.createThreadResponse,
    previewData: askingResolver.previewData,

    // Views
    createView: modelResolver.createView,
    deleteView: modelResolver.deleteView,
    previewViewData: modelResolver.previewViewData,
    validateView: modelResolver.validateView,
  },
  ThreadResponse: askingResolver.getThreadResponseNestedResolver(),
  DetailStep: askingResolver.getDetailStepNestedResolver(),
  ResultCandidate: askingResolver.getResultCandidateNestedResolver(),
};

export default resolvers;
