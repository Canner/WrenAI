const fs = require('fs');
const path = require('path');
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const distDir = process.env.NEXT_DIST_DIR || './.next';
const NEXT_EMPTY_MODULE_ALIAS = 'private-next-empty-module';
const NEXT_INSTRUMENTATION_CLIENT_ALIAS = 'private-next-instrumentation-client';
const NEXT_EMPTY_MODULE_PATH = path.join(
  __dirname,
  'src',
  'utils',
  'nextEmptyModule.ts',
);
const NEXT_INSTRUMENTATION_CLIENT_CANDIDATES = [
  path.join(__dirname, 'src', 'instrumentation-client.ts'),
  path.join(__dirname, 'src', 'instrumentation-client.js'),
  path.join(__dirname, 'instrumentation-client.ts'),
  path.join(__dirname, 'instrumentation-client.js'),
];
const nextInstrumentationClientPath =
  NEXT_INSTRUMENTATION_CLIENT_CANDIDATES.find((candidatePath) =>
    fs.existsSync(candidatePath),
  ) ?? NEXT_EMPTY_MODULE_PATH;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  distDir,
  staticPageGenerationTimeout: 1000,
  allowedDevOrigins: ['127.0.0.1', '::1'],
  transpilePackages: [
    'antd',
    '@ant-design/colors',
    '@ant-design/cssinjs',
    '@ant-design/cssinjs-utils',
    '@ant-design/fast-color',
    '@ant-design/icons',
    '@ant-design/react-slick',
    '@rc-component/color-picker',
    '@rc-component/mutate-observer',
    '@rc-component/qrcode',
    '@rc-component/tour',
    '@rc-component/trigger',
    'rc-cascader',
    'rc-checkbox',
    'rc-collapse',
    'rc-dialog',
    'rc-drawer',
    'rc-dropdown',
    'rc-field-form',
    'rc-image',
    'rc-input',
    'rc-input-number',
    'rc-mentions',
    'rc-menu',
    'rc-motion',
    'rc-notification',
    'rc-pagination',
    'rc-picker',
    'rc-progress',
    'rc-rate',
    'rc-resize-observer',
    'rc-segmented',
    'rc-select',
    'rc-slider',
    'rc-steps',
    'rc-switch',
    'rc-table',
    'rc-tabs',
    'rc-textarea',
    'rc-tooltip',
    'rc-tree',
    'rc-tree-select',
    'rc-upload',
    'rc-util',
  ],
  compiler: {
    // Enables the styled-components SWC transform
    styledComponents: {
      displayName: true,
      ssr: true,
    },
  },
  turbopack: {
    resolveAlias: {
      [NEXT_EMPTY_MODULE_ALIAS]: NEXT_EMPTY_MODULE_PATH,
      [NEXT_INSTRUMENTATION_CLIENT_ALIAS]: nextInstrumentationClientPath,
    },
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
};

module.exports = withBundleAnalyzer(nextConfig);
