import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CONNECTOR_CLEAR_SECRET_LABEL,
  buildConnectorsCollectionRequestKey,
  buildConnectorsCollectionUrl,
  buildConnectorItemUrl,
  buildConnectorSubmitPayload,
  buildConnectorTestPayload,
  buildConnectorTestUrl,
  buildSecretReencryptApiUrl,
  buildSecretReencryptPayload,
  normalizeConnectorsCollectionPayload,
  CONNECTOR_TYPE_OPTIONS,
  CONNECTOR_SECRET_EDIT_HINT,
  CONNECTOR_SECRET_ROTATION_HINT,
  CONNECTOR_TEST_HINT,
} from '../../../features/settings/connectors/connectorsPageUtils';
import { resolveConnectorManagementCapabilities } from '../../../features/settings/connectors/connectorManagementCapabilities';
import ManageConnectors from '../../../pages/settings/connectors';

const mockUseProtectedRuntimeScopePage = jest.fn();
const mockBuildRuntimeScopeUrl = jest.fn();
const mockUseAuthSession = jest.fn();
const mockUseRuntimeSelectorState = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();

let capturedTableProps: any;

jest.mock('@/runtime/client/runtimeScope', () => ({
  buildRuntimeScopeUrl: (...args: any[]) => mockBuildRuntimeScopeUrl(...args),
}));

jest.mock('antd', () => {
  const React = jest.requireActual('react');
  const Form = ({ children }: any) =>
    React.createElement('form', null, children);
  Form.Item = ({ children, label }: any) =>
    React.createElement('div', { 'data-label': label }, children);
  Form.useForm = () => [
    {
      getFieldsValue: jest.fn().mockReturnValue({ type: 'database' }),
      resetFields: jest.fn(),
      setFieldsValue: jest.fn(),
      validateFields: jest.fn(),
    },
  ];
  Form.useWatch = jest.fn((name: string) => {
    if (name === 'type') return 'database';
    if (name === 'databaseProvider') return 'postgres';
    if (name === 'dbSnowflakeAuthMode') return 'password';
    if (name === 'dbRedshiftAuthMode') return 'redshift';
    return undefined;
  });

  return {
    Alert: ({ children }: any) => React.createElement('div', null, children),
    Button: ({ children }: any) =>
      React.createElement('button', null, children),
    Card: ({ children }: any) => React.createElement('section', null, children),
    Form,
    Input: Object.assign((props: any) => React.createElement('input', props), {
      TextArea: (props: any) => React.createElement('textarea', props),
    }),
    Modal: ({ children }: any) => React.createElement('div', null, children),
    Popconfirm: ({ children }: any) =>
      React.createElement('div', null, children),
    Select: ({ options: _options, ...props }: any) =>
      React.createElement('select', props),
    Space: ({ children }: any) => React.createElement('div', null, children),
    Switch: ({ checked }: any) =>
      React.createElement('input', {
        type: 'checkbox',
        checked,
        readOnly: true,
      }),
    Table: (props: any) => {
      capturedTableProps = props;
      return React.createElement('div', { 'data-kind': 'table' });
    },
    Tag: ({ children }: any) => React.createElement('span', null, children),
    Typography: {
      Paragraph: ({ children }: any) =>
        React.createElement('p', null, children),
      Text: ({ children, strong }: any) =>
        React.createElement(strong ? 'strong' : 'span', null, children),
    },
    message: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
  };
});

jest.mock('@ant-design/icons/ApiOutlined', () => () => 'api-icon');

jest.mock('@/components/reference/ConsoleShellLayout', () => ({
  __esModule: true,
  default: ({ title, description, titleExtra, hideHeader, children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement(
      'div',
      null,
      title,
      description,
      hideHeader ? 'hide-header' : null,
      titleExtra,
      children,
    );
  },
}));

jest.mock('@/hooks/useProtectedRuntimeScopePage', () => ({
  __esModule: true,
  default: () => mockUseProtectedRuntimeScopePage(),
}));

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

jest.mock('@/hooks/useAuthSession', () => ({
  __esModule: true,
  default: () => mockUseAuthSession(),
}));

jest.mock('@/hooks/useRuntimeSelectorState', () => ({
  __esModule: true,
  default: () => mockUseRuntimeSelectorState(),
}));

const renderPage = () =>
  renderToStaticMarkup(React.createElement(ManageConnectors));

describe('knowledge/connectors page', () => {
  beforeEach(() => {
    capturedTableProps = undefined;
    jest.clearAllMocks();
    mockUseAuthSession.mockReturnValue({
      loading: false,
      authenticated: true,
      data: {
        authorization: {
          actions: {
            'connector.create': true,
            'connector.read': true,
            'connector.update': true,
            'connector.delete': true,
            'connector.rotate_secret': true,
          },
        },
      },
    });
    mockBuildRuntimeScopeUrl.mockImplementation((path: string) => path);
    mockUseProtectedRuntimeScopePage.mockReturnValue({
      guarding: false,
      hasRuntimeScope: true,
    });
    mockUseRuntimeScopeNavigation.mockReturnValue({
      pushWorkspace: jest.fn(),
      workspaceSelector: { workspaceId: 'ws-1' },
    });
    mockUseRuntimeSelectorState.mockReturnValue({});
  });

  it('builds runtime-scoped connector urls and exposes stable connector types', () => {
    expect(buildConnectorsCollectionUrl()).toBe('/api/v1/connectors');
    expect(buildConnectorsCollectionRequestKey({ workspaceId: 'ws-1' })).toBe(
      'ws-1',
    );
    expect(buildConnectorsCollectionRequestKey(null)).toBeNull();
    expect(normalizeConnectorsCollectionPayload(null)).toEqual([]);
    expect(buildConnectorItemUrl('connector-1')).toBe(
      '/api/v1/connectors/connector-1',
    );
    expect(buildConnectorTestUrl()).toBe('/api/v1/connectors/test');
    expect(buildSecretReencryptApiUrl()).toBe('/api/v1/secrets/reencrypt');
    expect(CONNECTOR_TYPE_OPTIONS).toEqual([
      { label: 'REST JSON API', value: 'rest_json' },
      { label: '数据库', value: 'database' },
      { label: 'Python 工具', value: 'python_tool' },
    ]);
    expect(CONNECTOR_SECRET_EDIT_HINT).toContain('继续沿用现有密钥');
    expect(CONNECTOR_CLEAR_SECRET_LABEL).toContain('清空现有密钥');
    expect(CONNECTOR_TEST_HINT).toContain('database 类型支持连接测试');
    expect(CONNECTOR_SECRET_ROTATION_HINT).toContain('不会暴露明文');
  });

  it('renders the connectors workspace without header and without workspace/context metric cards', () => {
    const markup = renderPage();

    expect(markup).toContain('hide-header');
    expect(markup).toContain('连接器目录');
    expect(markup).not.toContain('当前工作区');
    expect(markup).not.toContain('当前上下文');
    expect(markup).not.toContain('Workspace Connectors');
  });

  it('derives connector permissions from authorization actions', () => {
    expect(
      resolveConnectorManagementCapabilities({
        workspaceKind: 'regular',
        authorizationActions: {
          'connector.read': true,
        },
      }),
    ).toMatchObject({
      showPlatformManagement: false,
      connectorScopeRestrictionReason: null,
      connectorActionBlockedReason: '当前账号没有连接器管理权限',
      createConnectorBlockedReason: '当前账号没有创建连接器权限',
      updateConnectorBlockedReason: '当前账号没有编辑或测试连接器权限',
      deleteConnectorBlockedReason: '当前账号没有删除连接器权限',
      rotateConnectorSecretBlockedReason: '当前账号没有批量轮换密钥权限',
    });
  });

  it('lets managed sample workspaces block connector mutations even for admins', () => {
    expect(
      resolveConnectorManagementCapabilities({
        workspaceKind: 'default',
        authorizationActions: {
          'connector.create': true,
          'connector.update': true,
          'connector.delete': true,
          'connector.rotate_secret': true,
        },
        actorIsPlatformAdmin: true,
      }),
    ).toMatchObject({
      showPlatformManagement: true,
      connectorActionBlockedReason: '系统样例空间不支持接入或管理连接器',
      createConnectorBlockedReason: '系统样例空间不支持接入或管理连接器',
      updateConnectorBlockedReason: '系统样例空间不支持接入或管理连接器',
      deleteConnectorBlockedReason: '系统样例空间不支持接入或管理连接器',
      rotateConnectorSecretBlockedReason: '系统样例空间不支持接入或管理连接器',
    });
  });

  it('preserves existing secret on edit when secret json is left blank', () => {
    expect(
      buildConnectorSubmitPayload({
        editing: true,
        values: {
          type: 'rest_json',
          displayName: '  Sales API  ',
          configText: '{"baseUrl":"https://api.example.com"}',
          secretText: '   ',
        },
      }),
    ).toEqual({
      type: 'rest_json',
      displayName: 'Sales API',
      config: { baseUrl: 'https://api.example.com' },
    });

    expect(
      buildConnectorSubmitPayload({
        editing: false,
        values: {
          type: 'database',
          databaseProvider: 'postgres',
          displayName: 'Warehouse',
          configText:
            '{"host":"127.0.0.1","port":5432,"database":"analytics","user":"postgres"}',
          secretText: '{"password":"postgres"}',
        },
      }),
    ).toEqual({
      type: 'database',
      databaseProvider: 'postgres',
      displayName: 'Warehouse',
      config: {
        host: '127.0.0.1',
        port: 5432,
        database: 'analytics',
        user: 'postgres',
      },
      secret: { password: 'postgres' },
    });

    expect(
      buildConnectorSubmitPayload({
        editing: false,
        values: {
          type: 'rest_json',
          displayName: 'Weather API',
          configText: '',
          secretText: '{"apiKey":"secret"}',
        },
      }),
    ).toEqual({
      type: 'rest_json',
      displayName: 'Weather API',
      config: null,
      secret: { apiKey: 'secret' },
    });
  });

  it('builds structured database payloads from provider-specific fields', () => {
    expect(
      buildConnectorSubmitPayload({
        editing: false,
        values: {
          type: 'database',
          databaseProvider: 'postgres',
          displayName: 'Warehouse',
          dbHost: '127.0.0.1',
          dbPort: '5432',
          dbDatabase: 'analytics',
          dbUser: 'postgres',
          dbSchema: 'public',
          dbPassword: 'postgres',
        },
      }),
    ).toEqual({
      type: 'database',
      databaseProvider: 'postgres',
      displayName: 'Warehouse',
      config: {
        host: '127.0.0.1',
        port: 5432,
        database: 'analytics',
        user: 'postgres',
        schema: 'public',
        ssl: false,
      },
      secret: { password: 'postgres' },
    });

    expect(
      buildConnectorSubmitPayload({
        editing: false,
        values: {
          type: 'database',
          databaseProvider: 'bigquery',
          displayName: 'BQ',
          dbProjectId: 'my-gcp-project',
          dbDatasetId: 'analytics',
          dbCredentialsText:
            '{"type":"service_account","project_id":"my-gcp-project"}',
        },
      }),
    ).toEqual({
      type: 'database',
      databaseProvider: 'bigquery',
      displayName: 'BQ',
      config: {
        projectId: 'my-gcp-project',
        datasetId: 'analytics',
      },
      secret: {
        credentials: {
          type: 'service_account',
          project_id: 'my-gcp-project',
        },
      },
    });
  });

  it('sends secret: null when edit explicitly clears the existing secret', () => {
    expect(
      buildConnectorSubmitPayload({
        editing: true,
        values: {
          type: 'rest_json',
          displayName: 'Sales API',
          configText: '{"baseUrl":"https://api.example.com"}',
          secretText: '   ',
          clearSecret: true,
        },
      }),
    ).toEqual({
      type: 'rest_json',
      displayName: 'Sales API',
      config: { baseUrl: 'https://api.example.com' },
      secret: null,
    });
  });

  it('builds test payloads that preserve persisted secrets on edit', () => {
    expect(
      buildConnectorTestPayload({
        editingConnectorId: 'connector-1',
        preserveExistingSecret: true,
        values: {
          type: 'database',
          databaseProvider: 'postgres',
          configText: '{"host":"127.0.0.1","port":"5432"}',
          secretText: '   ',
        },
      }),
    ).toEqual({
      connectorId: 'connector-1',
      type: 'database',
      databaseProvider: 'postgres',
      config: { host: '127.0.0.1', port: '5432' },
    });

    expect(
      buildConnectorTestPayload({
        values: {
          type: 'database',
          databaseProvider: 'mysql',
          configText: '{"host":"127.0.0.1","port":"5432"}',
          secretText: '{"password":"postgres"}',
        },
      }),
    ).toEqual({
      type: 'database',
      databaseProvider: 'mysql',
      config: { host: '127.0.0.1', port: '5432' },
      secret: { password: 'postgres' },
    });
  });

  it('builds structured test payloads and preserves existing secret on edit', () => {
    expect(
      buildConnectorTestPayload({
        editingConnectorId: 'connector-2',
        preserveExistingSecret: true,
        values: {
          type: 'database',
          databaseProvider: 'snowflake',
          dbSnowflakeAccount: 'org-account',
          dbDatabase: 'ANALYTICS',
          dbSchema: 'PUBLIC',
          dbUser: 'analyst',
          dbSnowflakeAuthMode: 'password',
        },
      }),
    ).toEqual({
      connectorId: 'connector-2',
      type: 'database',
      databaseProvider: 'snowflake',
      config: {
        account: 'org-account',
        database: 'ANALYTICS',
        schema: 'PUBLIC',
        user: 'analyst',
      },
    });

    expect(() =>
      buildConnectorSubmitPayload({
        editing: false,
        values: {
          type: 'database',
          databaseProvider: 'postgres',
          displayName: 'Warehouse',
          dbHost: '127.0.0.1',
          dbPort: '5432',
          dbDatabase: 'analytics',
          dbUser: 'postgres',
        },
      }),
    ).toThrow('数据库密钥不能为空');
  });

  it('builds secret re-encrypt payloads with validated key versions', () => {
    expect(
      buildSecretReencryptPayload({
        targetKeyVersionText: '2',
        sourceKeyVersionText: '1',
        scopeType: 'connector',
        execute: true,
      }),
    ).toEqual({
      targetKeyVersion: 2,
      sourceKeyVersion: 1,
      scopeType: 'connector',
      execute: true,
    });

    expect(() =>
      buildSecretReencryptPayload({
        targetKeyVersionText: '0',
      }),
    ).toThrow('目标 key version 必须是正整数');
  });

  it('renders the connector management shell without the removed summary cards', () => {
    const markup = renderPage();

    expect(markup).toContain('数据连接器');
    expect(markup).not.toContain('批量轮换密钥');
    expect(markup).toContain('当前仅 database 类型支持连接测试');
    expect(markup).not.toContain('当前工作区');
    expect(markup).not.toContain('当前上下文');
    expect(capturedTableProps).toBeDefined();
    expect(capturedTableProps.dataSource).toEqual([]);
  });

  it('renders 名称/类型列 and keeps config json compact', () => {
    renderPage();

    const nameColumn = capturedTableProps.columns.find(
      (column: any) => column.title === '名称',
    );
    const typeColumn = capturedTableProps.columns.find(
      (column: any) => column.title === '类型',
    );
    const configColumn = capturedTableProps.columns.find(
      (column: any) => column.title === '配置',
    );

    expect(nameColumn).toBeDefined();
    expect(typeColumn).toBeDefined();
    expect(configColumn).toBeDefined();

    const nameMarkup = renderToStaticMarkup(
      nameColumn.render('Warehouse', {
        id: 'connector-1',
        type: 'database',
        databaseProvider: 'postgres',
        displayName: 'Warehouse',
      }),
    );
    expect(nameMarkup).toContain('Warehouse');
    expect(nameMarkup).not.toContain('database');

    const typeMarkup = renderToStaticMarkup(
      typeColumn.render('database', {
        id: 'connector-1',
        type: 'database',
        databaseProvider: 'postgres',
      }),
    );
    expect(typeMarkup).toContain('数据库');
    expect(typeMarkup).toContain('PostgreSQL');

    const configElement = configColumn.render({
      host: 'host.docker.internal',
      port: 4000,
      user: 'root',
    });
    const configMarkup = renderToStaticMarkup(configElement);
    expect(configElement.props.style.fontSize).toBe(12);
    expect(configElement.props.style.lineHeight).toBe(1.5);
    expect(configMarkup).toContain(
      '&quot;host&quot;: &quot;host.docker.internal&quot;',
    );
    expect(configMarkup).toContain('&quot;port&quot;: 4000');
  });
});
