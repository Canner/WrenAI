import GraphQLJSON from 'graphql-type-json';
import { ProjectResolver } from './resolvers/projectResolver';
import { ModelResolver } from './resolvers/modelResolver';
import { DiagramResolver } from './resolvers/diagramResolver';

const projectResolver = new ProjectResolver();
const modelResolver = new ModelResolver();
const diagramResolver = new DiagramResolver();

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
  },
  Mutation: {
    deploy: modelResolver.deploy,
    saveDataSource: projectResolver.saveDataSource,
    startSampleDataset: projectResolver.startSampleDataset,
    saveTables: projectResolver.saveTables,
    saveRelations: projectResolver.saveRelations,
    createModel: modelResolver.createModel,
    deleteModel: modelResolver.deleteModel,
  },
};

export default resolvers;
