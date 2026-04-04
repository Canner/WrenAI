import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CONNECTOR_CLEAR_SECRET_LABEL,
  buildConnectorsCollectionUrl,
  buildConnectorItemUrl,
  buildConnectorSubmitPayload,
  CONNECTOR_TYPE_OPTIONS,
  CONNECTOR_SECRET_EDIT_HINT,
  default as ManageConnectors,
} from './connectors';

const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseQuery = jest.fn();
const mockBuildRuntimeScopeUrl = jest.fn();

let capturedTableProps: any;

jest.mock('@apollo/client', () => ({
  gql: (strings: TemplateStringsArray) => strings.join(''),
  useQuery: (...args: any[]) => mockUseQuery(...args),
}));

jest.mock('@/apollo/client/runtimeScope', () => ({
  buildRuntimeScopeUrl: (...args: any[]) => mockBuildRuntimeScopeUrl(...args),
}));

jest.mock('antd', () => {
  const React = jest.requireActual('react');
  const Form = ({ children }: any) => React.createElement('form', null, children);
  Form.Item = ({ children }: any) => React.createElement('div', null, children);
  Form.useForm = () => [
    {
      resetFields: jest.fn(),
      setFieldsValue: jest.fn(),
      validateFields: jest.fn(),
    },
  ];

  return {
    Button: ({ children }: any) => React.createElement('button', null, children),
    Card: ({ children }: any) => React.createElement('section', null, children),
    Form,
    Input: Object.assign(
      (props: any) => React.createElement('input', props),
      { TextArea: (props: any) => React.createElement('textarea', props) },
    ),
    Modal: ({ children }: any) => React.createElement('div', null, children),
    Popconfirm: ({ children }: any) => React.createElement('div', null, children),
    Select: ({ options: _options, ...props }: any) => React.createElement('select', props),
    Space: ({ children }: any) => React.createElement('div', null, children),
    Switch: ({ checked }: any) =>
      React.createElement('input', { type: 'checkbox', checked, readOnly: true }),
    Table: (props: any) => {
      capturedTableProps = props;
      return React.createElement('div', { 'data-kind': 'table' });
    },
    Tag: ({ children }: any) => React.createElement('span', null, children),
    Typography: {
      Paragraph: ({ children }: any) => React.createElement('p', null, children),
      Text: ({ children, strong }: any) =>
        React.createElement(strong ? 'strong' : 'span', null, children),
    },
    message: { success: jest.fn(), error: jest.fn() },
  };
});

jest.mock('@ant-design/icons/ApiOutlined', () => () => 'api-icon');

jest.mock('@/components/layouts/PageLayout', () => ({
  __esModule: true,
  default: ({ title, description, titleExtra, children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, title, description, titleExtra, children);
  },
}));

jest.mock('@/components/layouts/SiderLayout', () => ({
  __esModule: true,
  default: ({ children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, children);
  },
}));

jest.mock('@/hooks/useProtectedRuntimeScopePage', () => ({
  __esModule: true,
  default: () => mockUseProtectedRuntimeScopePage(),
}));

const renderPage = () => renderToStaticMarkup(React.createElement(ManageConnectors));

describe('knowledge/connectors page', () => {
  beforeEach(() => {
    capturedTableProps = undefined;
    jest.clearAllMocks();
    mockBuildRuntimeScopeUrl.mockImplementation((path: string) => path);
    mockUseProtectedRuntimeScopePage.mockReturnValue({
      guarding: false,
      hasRuntimeScope: true,
    });
    mockUseQuery.mockReturnValue({
      data: {
        runtimeSelectorState: {
          currentWorkspace: { id: 'ws-1', name: 'Workspace Alpha' },
          currentKnowledgeBase: { id: 'kb-1', name: 'Knowledge Base A' },
        },
      },
    });
  });

  it('builds runtime-scoped connector urls and exposes stable connector types', () => {
    expect(buildConnectorsCollectionUrl()).toBe('/api/v1/connectors');
    expect(buildConnectorItemUrl('connector-1')).toBe('/api/v1/connectors/connector-1');
    expect(CONNECTOR_TYPE_OPTIONS).toEqual([
      { label: 'REST JSON', value: 'rest_json' },
      { label: 'Database', value: 'database' },
      { label: 'Python Tool', value: 'python_tool' },
    ]);
    expect(CONNECTOR_SECRET_EDIT_HINT).toContain('keep the existing secret');
    expect(CONNECTOR_CLEAR_SECRET_LABEL).toContain('Clear existing secret');
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

  it('renders runtime selector labels and connector table shell', () => {
    const markup = renderPage();

    expect(markup).toContain('Manage connectors');
    expect(markup).toContain('Workspace Alpha');
    expect(markup).toContain('Knowledge Base A');
    expect(capturedTableProps).toBeDefined();
    expect(capturedTableProps.dataSource).toEqual([]);
  });
});
