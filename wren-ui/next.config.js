/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const withLess = require('next-with-less');

const resolveAlias = {
  antd$: path.resolve(__dirname, 'node_modules/antd/lib'),
  '@ant-design/icons$': path.resolve(
    __dirname,
    'node_modules/@ant-design/icons/lib',
  ),
};

/** @type {import('next').NextConfig} */
const nextConfig = withLess({
  output: 'standalone',
  staticPageGenerationTimeout: 1000,
  compiler: {
    // Enables the styled-components SWC transform
    styledComponents: {
      displayName: true,
      ssr: true,
    },
  },
  lessLoaderOptions: {
    additionalData: `@import "@/styles/antd-variables.less";`,
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...resolveAlias,
    };
    return config;
  },
  // routes redirect
  async redirects() {
    return [
      {
        source: '/setup',
        destination: '/setup/connection',
        permanent: true,
      },
    ];
  },
});

module.exports = nextConfig;
