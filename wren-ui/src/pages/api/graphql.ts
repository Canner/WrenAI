import microCors from 'micro-cors';
import { NextApiRequest, NextApiResponse, PageConfig } from 'next';
import { ApolloServer } from 'apollo-server-micro';
import { typeDefs } from '@server';
import resolvers from '@server/resolvers';
import { IContext } from '@server/types';
import {
  ModelColumnRepository,
  ModelRepository,
  ProjectRepository,
  RelationRepository,
} from '@server/repositories';
import { bootstrapKnex } from '../../apollo/server/utils/knex';
import { GraphQLError } from 'graphql';
import { getLogger } from '@server/utils';
import { getConfig } from '@server/config';
import { ProjectService } from '@server/services/projectService';
import { ModelService } from '@server/services/modelService';
import { MDLService } from '@server/services/mdlService';

const serverConfig = getConfig();
const apolloLogger = getLogger('APOLLO');

const cors = microCors();

export const config: PageConfig = {
  api: {
    bodyParser: false,
  },
};
const knex = bootstrapKnex({
  dbType: serverConfig.dbType,
  pgUrl: serverConfig.pgUrl,
  debug: serverConfig.debug,
  sqliteFile: serverConfig.sqliteFile,
});
const projectRepository = new ProjectRepository(knex);
const modelRepository = new ModelRepository(knex);
const modelColumnRepository = new ModelColumnRepository(knex);
const relationRepository = new RelationRepository(knex);

const projectService = new ProjectService({ projectRepository });
const modelService = new ModelService();
const mdlService = new MDLService({
  projectRepository,
  modelRepository,
  modelColumnRepository,
  relationRepository,
});

const apolloServer: ApolloServer = new ApolloServer({
  typeDefs,
  resolvers,
  formatError: (error: GraphQLError) => {
    apolloLogger.error(error.extensions);
    return error;
  },
  introspection: process.env.NODE_ENV !== 'production',
  context: (): IContext => ({
    config: serverConfig,

    // services
    projectService,
    modelService,
    mdlService,

    // repository
    projectRepository,
    modelRepository,
    modelColumnRepository,
    relationRepository,
  }),
});

const startServer = apolloServer.start();

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  await startServer;
  await apolloServer.createHandler({
    path: '/api/graphql',
  })(req, res);
};

export default cors((req: NextApiRequest, res: NextApiResponse) =>
  req.method === 'OPTIONS' ? res.status(200).end() : handler(req, res),
);
