import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildSkillConnectorOptions,
  buildSkillConnectorsApiUrl,
  buildSkillDefinitionSubmitPayload,
  SKILL_CLEAR_SECRET_LABEL,
  SKILL_SECRET_EDIT_HINT,
  default as ManageSkills,
} from '../../../pages/settings/skills';

const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRuntimeSelectorState = jest.fn();
const mockUseSkillsControlPlaneData = jest.fn();
const mockBuildRuntimeScopeUrl = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseAuthSession = jest.fn();

let capturedTables: any[] = [];
let capturedSelectProps: any[] = [];

jest.mock('@/runtime/client/runtimeScope', () => ({
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

  const Form = ({ children }: any) =>
    React.createElement('form', null, children);
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
    Form,
    Input: Object.assign(
      ({ children, ...props }: any) =>
        React.createElement('input', props, children),
      {
        TextArea: ({ children, ...props }: any) =>
          React.createElement('textarea', props, children),
      },
    ),
    Modal: ({ title, okText, children }: any) =>
      React.createElement('div', null, title, okText, children),
    Popconfirm: ({ children }: any) =>
      React.createElement('div', null, children),
    Select: ({
      showSearch: _showSearch,
      options,
      loading: _loading,
      allowClear: _allowClear,
      ...props
    }: any) => {
      capturedSelectProps.push({ options, ...props });
      return React.createElement('select', props);
    },
    Space: ({ children }: any) => React.createElement('div', null, children),
    Switch: (props: any) =>
      React.createElement('input', { type: 'checkbox', ...props }),
    Table: (props: any) => {
      capturedTables.push(props);
      return React.createElement('div', { 'data-kind': 'table' });
    },
    Tag: ({ children }: any) => React.createElement('span', null, children),
    Typography: {
      Text: ({ children, strong, type: _type }: any) =>
        React.createElement(strong ? 'strong' : 'span', null, children),
      Paragraph: ({ children }: any) =>
        React.createElement('p', null, children),
    },
    message: {
      success: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
    },
  };
});

jest.mock('@ant-design/icons/CodeOutlined', () => () => 'code-icon');

jest.mock('@/components/reference/ConsoleShellLayout', () => ({
  __esModule: true,
  default: ({ title, description, children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, title, description, children);
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

jest.mock('@/hooks/useRuntimeSelectorState', () => ({
  __esModule: true,
  default: () => mockUseRuntimeSelectorState(),
}));

jest.mock('@/hooks/useSkillsControlPlaneData', () => ({
  __esModule: true,
  default: (args: any) => mockUseSkillsControlPlaneData(args),
}));

jest.mock('@/hooks/useAuthSession', () => ({
  __esModule: true,
  default: () => mockUseAuthSession(),
}));

const renderPage = () =>
  renderToStaticMarkup(React.createElement(ManageSkills));

describe('knowledge/skills page', () => {
  beforeEach(() => {
    capturedTables = [];
    capturedSelectProps = [];
    jest.clearAllMocks();
    mockUseAuthSession.mockReturnValue({
      loading: false,
      authenticated: true,
      data: {
        authorization: {
          actions: {
            'skill.create': true,
            'skill.read': true,
            'skill.update': true,
            'skill.delete': true,
          },
        },
      },
    });
    mockBuildRuntimeScopeUrl.mockImplementation(
      (path: string) => `${path}?knowledgeBaseId=kb-1`,
    );
    mockUseRuntimeScopeNavigation.mockReturnValue({
      selector: { workspaceId: 'ws-1', knowledgeBaseId: 'kb-1' },
      href: (path: string) => `${path}?knowledgeBaseId=kb-1`,
      hrefWorkspace: (path: string) => `${path}?workspaceId=ws-1`,
      push: jest.fn(),
      pushWorkspace: jest.fn(),
    });
    mockUseRuntimeSelectorState.mockReturnValue({
      runtimeSelectorState: {
        currentWorkspace: { id: 'ws-1', name: 'Workspace Alpha' },
        currentKnowledgeBase: { id: 'kb-1', name: 'Knowledge Base A' },
        currentKbSnapshot: { id: 'snap-1', displayName: 'Snapshot A' },
        kbSnapshots: [{ id: 'snap-1', displayName: 'Snapshot A' }],
      },
      loading: false,
      refetch: jest.fn(),
    });
    mockUseSkillsControlPlaneData.mockReturnValue({
      data: {
        marketplaceCatalogSkills: [],
        skillDefinitions: [],
      },
      loading: false,
      refetch: jest.fn(),
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

    renderPage();

    expect(mockUseSkillsControlPlaneData).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
      }),
    );
  });

  it('renders marketplace and runtime skill tables', () => {
    mockUseProtectedRuntimeScopePage.mockReturnValue({
      guarding: false,
      hasRuntimeScope: true,
    });
    mockUseSkillsControlPlaneData.mockReturnValue({
      loading: false,
      refetch: jest.fn(),
      data: {
        marketplaceCatalogSkills: [
          {
            id: 'catalog-1',
            slug: 'sales-copilot',
            name: 'Sales Copilot',
            runtimeKind: 'isolated_python',
            defaultExecutionMode: 'inject_only',
            description: '市场技能',
            isBuiltin: false,
          },
        ],
        skillDefinitions: [
          {
            id: 'skill-1',
            workspaceId: 'ws-1',
            name: 'Sales API',
            runtimeKind: 'isolated_python',
            sourceType: 'api',
            sourceRef: 'openapi://sales',
            entrypoint: 'main:run',
            instruction: '仅统计已支付订单',
            isEnabled: true,
            executionMode: 'inject_only',
            connectorId: 'connector-1',
            kbSuggestionIds: ['kb-1'],
            installedFrom: 'marketplace',
            manifest: { timeoutMs: 1000 },
            hasSecret: true,
          },
        ],
      },
    });

    const markup = renderPage();

    expect(markup).toContain('Workspace Alpha');
    expect(markup).toContain('Knowledge Base A');
    expect(markup).toContain('技能市场');
    expect(markup).toContain('我的技能');
    expect(capturedTables).toHaveLength(2);
    expect(capturedTables[0].dataSource).toHaveLength(1);
    expect(capturedTables[1].dataSource).toHaveLength(1);

    const runtimeColumn = capturedTables[1].columns.find(
      (column: any) => column.title === '运行时配置',
    );
    const suggestionColumn = capturedTables[1].columns.find(
      (column: any) => column.title === '指令 / 推荐范围',
    );

    expect(
      renderToStaticMarkup(
        runtimeColumn.render(null, capturedTables[1].dataSource[0]),
      ),
    ).toContain('执行模式：inject_only');
    expect(
      renderToStaticMarkup(
        suggestionColumn.render(null, capturedTables[1].dataSource[0]),
      ),
    ).toContain('仅统计已支付订单');
  });

  it('builds connector options and runtime-scoped api urls', () => {
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
      { label: '无连接器', value: '' },
      { label: 'Sales API (rest_json)', value: 'connector-1' },
    ]);

    expect(buildSkillConnectorsApiUrl()).toBe(
      '/api/v1/connectors?knowledgeBaseId=kb-1',
    );
  });

  it('builds skill definition payloads for preserve, set and clear secret modes', () => {
    expect(
      buildSkillDefinitionSubmitPayload({
        editing: false,
        clearSecret: false,
        values: {
          name: 'sales_skill',
          runtimeKind: 'isolated_python',
          sourceType: 'inline',
          sourceRef: 'skills/sales',
          entrypoint: 'main:run',
          manifestText: '{"timeoutMs":1000}',
          secretText: '{"apiKey":"secret"}',
          instruction: '仅统计已支付订单',
          executionMode: 'inject_only',
          connectorId: 'connector-1',
          enabled: true,
          runtimeConfigText: '{"timeoutSec":30}',
          kbSuggestionIdsText: 'kb-1\nkb-2',
        },
      }),
    ).toEqual(
      expect.objectContaining({
        name: 'sales_skill',
        manifest: { timeoutMs: 1000 },
        secret: { apiKey: 'secret' },
        instruction: '仅统计已支付订单',
        executionMode: 'inject_only',
        connectorId: 'connector-1',
        runtimeConfig: { timeoutSec: 30 },
        kbSuggestionIds: ['kb-1', 'kb-2'],
      }),
    );

    expect(
      buildSkillDefinitionSubmitPayload({
        editing: true,
        clearSecret: false,
        values: {
          name: 'sales_skill',
          secretText: '',
        },
      }),
    ).toEqual(
      expect.objectContaining({
        name: 'sales_skill',
        executionMode: 'inject_only',
      }),
    );
    expect(SKILL_SECRET_EDIT_HINT).toContain('后端运行时上下文');

    expect(
      buildSkillDefinitionSubmitPayload({
        editing: true,
        clearSecret: true,
        values: {
          name: 'sales_skill',
        },
      }),
    ).toEqual(
      expect.objectContaining({
        name: 'sales_skill',
        secret: null,
      }),
    );
    expect(SKILL_CLEAR_SECRET_LABEL).toContain('清空');
  });
});
