const path = require('path');
const withLess = require('next-with-less');
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const distDir = process.env.NEXT_DIST_DIR || './.next';
const NEXT_EMPTY_MODULE_ALIAS = 'private-next-empty-module';
const NEXT_INSTRUMENTATION_CLIENT_ALIAS = 'private-next-instrumentation-client';

/** @type {import('next').NextConfig} */
const nextConfig = withLess({
  output: 'standalone',
  distDir,
  staticPageGenerationTimeout: 1000,
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
  devIndicators: false,
  webpack(config, { dir, isServer }) {
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.alias = config.resolve.alias || {};

      if (config.resolve.alias[NEXT_EMPTY_MODULE_ALIAS] === undefined) {
        config.resolve.alias[NEXT_EMPTY_MODULE_ALIAS] = false;
      }

      if (
        config.resolve.alias[NEXT_INSTRUMENTATION_CLIENT_ALIAS] === undefined
      ) {
        config.resolve.alias[NEXT_INSTRUMENTATION_CLIENT_ALIAS] = [
          path.join(dir, 'src', 'instrumentation-client'),
          path.join(dir, 'instrumentation-client'),
          NEXT_EMPTY_MODULE_ALIAS,
        ];
      }
    }

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

module.exports = withBundleAnalyzer(nextConfig);
