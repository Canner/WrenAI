import { ApolloClient, HttpLink, InMemoryCache, from } from '@apollo/client';
import { onError } from '@apollo/client/link/error';
import { setContext } from '@apollo/client/link/context';
import errorHandler from '@/utils/errorHandler';
import {
  mergeRuntimeScopeRequestHeaders,
  resolveClientRuntimeScopeSelector,
} from './runtimeScope';

const apolloErrorLink = onError((error) => errorHandler(error));
const runtimeScopeLink = setContext((_operation, previousContext) => {
  if (previousContext.skipRuntimeScopeHeaders) {
    return previousContext;
  }

  return {
    ...previousContext,
    headers: mergeRuntimeScopeRequestHeaders(
      previousContext.headers || {},
      resolveClientRuntimeScopeSelector(),
    ),
  };
});

const httpLink = new HttpLink({
  uri: '/api/graphql',
});

const cache = new InMemoryCache({
  typePolicies: {
    AskingTask: {
      keyFields: ['queryId'],
    },
    Query: {
      fields: {
        askingTask: {
          keyArgs: ['taskId'],
        },
        getProjectRecommendationQuestions: {
          merge: false,
        },
        getThreadRecommendationQuestions: {
          keyArgs: ['threadId'],
          merge: false,
        },
        instantRecommendedQuestions: {
          keyArgs: ['taskId'],
          merge: false,
        },
        runtimeSelectorState: {
          merge: false,
        },
        thread: {
          keyArgs: ['threadId'],
        },
        threadResponse: {
          keyArgs: ['responseId'],
        },
        threads: {
          merge: false,
        },
      },
    },
    RecommendedQuestionsTask: {
      keyFields: false,
    },
    RuntimeSelectorKBSnapshot: {
      keyFields: ['id'],
    },
    RuntimeSelectorKnowledgeBase: {
      keyFields: ['id'],
    },
    RuntimeSelectorWorkspace: {
      keyFields: ['id'],
    },
    SkillDefinition: {
      keyFields: ['id'],
    },
    Thread: {
      keyFields: ['id'],
    },
    ThreadResponse: {
      keyFields: ['id'],
    },
  },
});

const client = new ApolloClient({
  link: from([apolloErrorLink, runtimeScopeLink, httpLink]),
  cache,
});

export default client;
