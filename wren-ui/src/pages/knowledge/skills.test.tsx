import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildSkillConnectorOptions,
  buildSkillConnectorsApiUrl,
  default as ManageSkills,
} from './skills';

const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseQuery = jest.fn();
const mockUseMutation = jest.fn();
const mockBuildRuntimeScopeUrl = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();

let capturedTables: any[] = [];
let capturedSelectProps: any[] = [];

jest.mock('@apollo/client', () => ({
  gql: (strings: TemplateStringsArray) => strings.join(''),
  useQuery: (args: any, options: any) => mockUseQuery(args, options),
  useMutation: (...args: any[]) => mockUseMutation(...args),
}));

jest.mock('@/apollo/client/runtimeScope', () => ({
  buildRuntimeScopeUrl: (...args: any[]) => mockBuildRuntimeScopeUrl(...args),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('a', { href }, children);
  },
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
    Button: ({ children, disabled, onClick }: any) =>
      React.createElement('button', { disabled, onClick }, children),
    Card: ({ title, extra, children }: any) =>
      React.createElement('section', null, title, extra, children),
    Col: ({ children }: any) => React.createElement('div', null, children),
    Form,
    Input: Object.assign(
      ({ children, ...props }: any) => React.createElement('input', props, children),
      {
        TextArea: ({ children, ...props }: any) =>
          React.createElement('textarea', props, children),
      },
    ),
    Modal: ({ children }: any) => React.createElement('div', null, children),
    Popconfirm: ({ children }: any) => React.createElement('div', null, children),
    Row: ({ children }: any) => React.createElement('div', null, children),
    Select: (
      {
        showSearch: _showSearch,
        options,
        loading: _loading,
        allowClear: _allowClear,
        ...props
      }: any,
    ) => {
      capturedSelectProps.push({ options, ...props });
      return React.createElement('select', props);
    },
    Space: ({ children }: any) => React.createElement('div', null, children),
    Switch: (props: any) => React.createElement('input', { type: 'checkbox', ...props }),
    Table: (props: any) => {
      capturedTables.push(props);
      return React.createElement('div', { 'data-kind': 'table' });
    },
    Tag: ({ children }: any) => React.createElement('span', null, children),
    Typography: {
      Text: ({ children, strong }: any) =>
        React.createElement(strong ? 'strong' : 'span', null, children),
      Paragraph: ({ children }: any) => React.createElement('p', null, children),
    },
    message: {
      success: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock('@ant-design/icons/CodeOutlined', () => () => 'code-icon');

jest.mock('@/components/layouts/PageLayout', () => ({
  __esModule: true,
  default: ({ title, description, children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, title, description, children);
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

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

const renderPage = () => renderToStaticMarkup(React.createElement(ManageSkills));

describe('knowledge/skills page', () => {
  beforeEach(() => {
    capturedTables = [];
    capturedSelectProps = [];
    jest.clearAllMocks();
    mockUseMutation.mockReturnValue([jest.fn(), { loading: false }]);
    mockBuildRuntimeScopeUrl.mockReturnValue('/api/v1/connectors?knowledgeBaseId=kb-1');
    mockUseRuntimeScopeNavigation.mockReturnValue({
      href: (path: string) => `${path}?knowledgeBaseId=kb-1`,
    });
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
  });

  it('skips control-plane query when runtime scope is unavailable', () => {
    mockUseProtectedRuntimeScopePage.mockReturnValue({
      guarding: false,
      hasRuntimeScope: false,
    });
    mockUseQuery.mockReturnValue({
      data: undefined,
      loading: false,
      refetch: jest.fn(),
    });

    renderPage();

    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fetchPolicy: 'cache-and-network',
        skip: true,
      }),
    );
  });

  it('maps skill definitions and bindings with runtime selector labels', () => {
    mockUseProtectedRuntimeScopePage.mockReturnValue({
      guarding: false,
      hasRuntimeScope: true,
    });
    mockUseQuery.mockReturnValue({
      loading: false,
      refetch: jest.fn(),
      data: {
        runtimeSelectorState: {
          currentWorkspace: { id: 'ws-1', name: 'Workspace Alpha' },
          currentKnowledgeBase: { id: 'kb-1', name: 'Knowledge Base A' },
          currentKbSnapshot: { id: 'snap-1', displayName: 'Snapshot A' },
          kbSnapshots: [{ id: 'snap-1', displayName: 'Snapshot A' }],
        },
        skillDefinitions: [
          {
            id: 'skill-1',
            workspaceId: 'ws-1',
            name: 'Sales API',
            runtimeKind: 'isolated_python',
            sourceType: 'api',
            sourceRef: 'openapi://sales',
            entrypoint: 'main:run',
            manifest: { timeoutMs: 1000 },
          },
        ],
        skillBindings: [
          {
            id: 'binding-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snap-1',
            skillDefinitionId: 'skill-1',
            connectorId: 'connector-1',
            bindingConfig: { toolName: 'sales_tool' },
            enabled: true,
          },
        ],
      },
    });

    const markup = renderPage();

    expect(markup).toContain('Workspace Alpha');
    expect(markup).toContain('Knowledge Base A');
    expect(markup).toContain('/knowledge/connectors?knowledgeBaseId=kb-1');
    expect(capturedTables).toHaveLength(2);
    expect(capturedTables[0].dataSource).toHaveLength(1);
    expect(capturedTables[1].dataSource).toHaveLength(1);

    const skillColumn = capturedTables[1].columns.find(
      (column: any) => column.title === 'Skill',
    );
    const bindingScopeColumn = capturedTables[1].columns.find(
      (column: any) => column.title === 'Binding scope',
    );

    expect(
      renderToStaticMarkup(skillColumn.render('skill-1')),
    ).toContain('Sales API');
    expect(
      renderToStaticMarkup(
        bindingScopeColumn.render(null, capturedTables[1].dataSource[0]),
      ),
    ).toContain('Snapshot: Snapshot A');
    expect(
      renderToStaticMarkup(
        bindingScopeColumn.render(null, capturedTables[1].dataSource[0]),
      ),
    ).toContain('Connector: connector-1');
  });

  it('builds connector options with a safe empty option and runtime-scoped API url', () => {
    expect(
      buildSkillConnectorOptions([
        {
          id: 'connector-1',
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          type: 'rest_json',
          displayName: 'Sales API',
        },
      ]),
    ).toEqual([
      { label: 'No connector', value: '' },
      { label: 'Sales API (rest_json)', value: 'connector-1' },
    ]);

    expect(buildSkillConnectorsApiUrl()).toBe(
      '/api/v1/connectors?knowledgeBaseId=kb-1',
    );
    expect(mockBuildRuntimeScopeUrl).toHaveBeenCalledWith('/api/v1/connectors');
  });
});
