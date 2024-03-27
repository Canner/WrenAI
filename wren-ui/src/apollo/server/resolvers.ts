import GraphQLJSON from 'graphql-type-json';
import {
  UsableDataSource,
  DataSourceName,
  DataSource,
  CreateModelPayload,
  UpdateModelPayload,
  UpdateModelWhere,
  DeleteModelWhere,
  GetModelWhere,
  CompactTable,
} from './types';
import * as demoManifest from './manifest.json';
import { pick } from 'lodash';
import { ProjectResolver } from './resolvers/projectResolver';
import { ModelResolver } from './resolvers/modelResolver';
import { AskingResolver } from './resolvers/askingResolver';
import { DiagramResolver } from './resolvers/diagramResolver';

const mockResolvers = {
  JSON: GraphQLJSON,
  Query: {
    usableDataSource: () =>
      [
        {
          type: DataSourceName.BIG_QUERY,
          requiredProperties: ['displayName', 'projectId', 'credentials'],
        },
      ] as UsableDataSource[],
    listDataSourceTables: () =>
      [
        {
          name: 'orders',
          columns: [
            {
              name: 'id',
              type: 'string',
            },
            {
              name: 'customerId',
              type: 'string',
            },
            {
              name: 'productId',
              type: 'string',
            },
          ],
        },
        {
          name: 'customers',
          columns: [
            {
              name: 'id',
              type: 'string',
            },
            {
              name: 'name',
              type: 'string',
            },
          ],
        },
        {
          name: 'products',
          columns: [
            {
              name: 'id',
              type: 'string',
            },
            {
              name: 'name',
              type: 'string',
            },
          ],
        },
      ] as CompactTable[],
    autoGenerateRelation: () => [],
    listModels: () => {
      const { models } = demoManifest;
      return models.map((model) => ({
        ...pick(model, [
          'name',
          'refSql',
          'primaryKey',
          'cached',
          'refreshTime',
          'description',
        ]),
      }));
    },
    model: (_, args: { where: GetModelWhere }) => {
      const { where } = args;
      const { models } = demoManifest;
      const model = models.find((model) => model.name === where.name);
      return {
        ...pick(model, [
          'name',
          'refSql',
          'primaryKey',
          'cached',
          'refreshTime',
          'description',
        ]),
        columns: model.columns.map((column) => ({
          ...pick(column, [
            'name',
            'type',
            'isCalculated',
            'notNull',
            'properties',
          ]),
        })),
        properties: model.properties,
      };
    },
  },
  Mutation: {
    saveDataSource: (_, args: { data: DataSource }) => {
      return args.data;
    },
    saveTables: (
      _,
      _args: {
        data: [tables: { name: string; columns: string[] }];
      },
    ) => {
      return demoManifest;
    },
    createModel: (_, args: { data: CreateModelPayload }) => {
      const { data } = args;
      const { fields = [], customFields = [], calculatedFields = [] } = data;
      return {
        name: data.tableName,
        refSql: `SELECT * FROM ${data.tableName}`,
        columns: [
          ...fields.map((field) => ({
            name: field,
            type: 'string',
            isCalculated: false,
            notNull: false,
            properties: {},
          })),
          ...customFields.map((field) => ({
            name: field.name,
            type: 'string',
            isCalculated: false,
            notNull: false,
            properties: {},
          })),
          ...calculatedFields.map((field) => ({
            name: field.name,
            type: 'string',
            isCalculated: true,
            notNull: false,
            properties: {},
          })),
        ],
        properties: {
          displayName: data.displayName,
          description: data.description,
        },
      };
    },
    updateModel: (
      _,
      args: { where: UpdateModelWhere; data: UpdateModelPayload },
    ) => {
      const { where, data } = args;
      const { models } = demoManifest;
      const model =
        models.find((model) => model.name === where.name) || models[0];
      return {
        ...pick(model, [
          'name',
          'refSql',
          'primaryKey',
          'cached',
          'refreshTime',
          'description',
        ]),
        columns: model.columns.map((column) => ({
          ...pick(column, [
            'name',
            'type',
            'isCalculated',
            'notNull',
            'properties',
          ]),
        })),
        properties: {
          ...model.properties,
          displayName: data.displayName,
          description: data.description,
        },
      };
    },
    deleteModel: (_, _args: { where: DeleteModelWhere }) => {
      return true;
    },
  },
};

const projectResolver = new ProjectResolver();
const modelResolver = new ModelResolver();
const askingResolver = new AskingResolver();
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

    // Ask
    askingTask: askingResolver.getAskingTask,
    askQuestions: askingResolver.getAskQuestions,

    // Thread
    thread: askingResolver.getThread,
    threads: askingResolver.listThreads,
    threadResponse: askingResolver.getResponse,
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
  },
  ThreadResponse: askingResolver.getThreadResponseNestedResolver(),
  DetailStep: askingResolver.getDetailStepNestedResolver(),
};

const useMockResolvers = process.env.APOLLO_RESOLVER === 'mock';
useMockResolvers
  ? console.log('Using mock resolvers')
  : console.log('Using real resolvers');
export default process.env.APOLLO_RESOLVER === 'mock'
  ? mockResolvers
  : resolvers;
