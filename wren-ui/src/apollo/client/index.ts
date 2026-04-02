import { ApolloClient, HttpLink, InMemoryCache, from } from '@apollo/client';
import { onError } from '@apollo/client/link/error';
import { setContext } from '@apollo/client/link/context';
import errorHandler from '@/utils/errorHandler';
import {
  buildRuntimeScopeHeaders,
  resolveClientRuntimeScopeSelector,
} from './runtimeScope';

const apolloErrorLink = onError((error) => errorHandler(error));
const runtimeScopeLink = setContext((_operation, previousContext) => ({
  headers: {
    ...(previousContext.headers || {}),
    ...buildRuntimeScopeHeaders(resolveClientRuntimeScopeSelector()),
  },
}));

const httpLink = new HttpLink({
  uri: '/api/graphql',
});

const client = new ApolloClient({
  link: from([apolloErrorLink, runtimeScopeLink, httpLink]),
  cache: new InMemoryCache(),
});

export default client;
