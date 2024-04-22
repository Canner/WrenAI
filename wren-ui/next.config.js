/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const withAntdLess = require('next-plugin-antd-less');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  staticPageGenerationTimeout: 1000,
  compiler: {
    // Enables the styled-components SWC transform
    styledComponents: {
      displayName: true,
      ssr: true,
    },
  },
  ...withAntdLess({
    // next-plugin-antd-less options
    lessVarsFilePath: path.resolve(__dirname, 'src/styles/antd-variables.less'),
    lessVarsFilePathAppendToEndOfContent: false,
  }),
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
};

module.exports = nextConfig;
