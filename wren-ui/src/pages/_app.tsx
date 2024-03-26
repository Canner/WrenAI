import { AppProps } from 'next/app';
import Head from 'next/head';
import apolloClient from '@/apollo/client';
import { ApolloProvider } from '@apollo/client';
import { Spin } from 'antd';
require('../styles/index.less');
import { defaultIndicator } from '@/components/PageLoading';

Spin.setDefaultIndicator(defaultIndicator);

function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Admin ui</title>
      </Head>
      <ApolloProvider client={apolloClient}>
        <main className="app">
          <Component {...pageProps} />
        </main>
      </ApolloProvider>
    </>
  );
}

export default App;
