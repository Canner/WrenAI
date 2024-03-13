const path = require('path');
const withAntdLess = require('next-plugin-antd-less');

/** @type {import('next').NextConfig} */
const nextConfig = {
  compiler: {
    // Enables the styled-components SWC transform
    styledComponents: {
      displayName: true,
      ssr: true,
    },
  },
  serverRuntimeConfig: {
    PG_DATABASE: process.env.PG_DATABASE,
    PG_PORT: process.env.PG_PORT,
    PG_USERNAME: process.env.PG_USERNAME,
    PG_PASSWORD: process.env.PG_PASSWORD,
  },
  ...withAntdLess({
    // next-plugin-antd-less options
    lessVarsFilePath: path.resolve(__dirname, 'src/styles/antd-variables.less'),
    lessVarsFilePathAppendToEndOfContent: false,
  }),
};

module.exports = nextConfig
