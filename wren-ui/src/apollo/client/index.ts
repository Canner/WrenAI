import { ApolloClient, HttpLink, InMemoryCache, from } from '@apollo/client';
import errorHandler from '@/utils/errorHandler';

const { onError } = require('@apollo/client/link/error/error.cjs');

const apolloErrorLink = onError((error) => errorHandler(error));

const httpLink = new HttpLink({
  uri: '/api/graphql',
});

const client = new ApolloClient({
  link: from([apolloErrorLink, httpLink]),
  cache: new InMemoryCache(),
});

export default client;
