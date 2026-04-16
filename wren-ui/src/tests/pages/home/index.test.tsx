import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HomePage, {
  clearHomeSkillOptionsCacheForTests,
  normalizeHomeSkillOptions,
  resolveAskRuntimeSelector,
  shouldLoadHomeSkillOptions,
} from '../../../pages/home';
import { HISTORICAL_SNAPSHOT_READONLY_HINT } from '../../../utils/runtimeSnapshot';

const mockUseHomeSidebar = jest.fn();
const mockUseAskPrompt = jest.fn();
const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseRuntimeSelectorState = jest.fn();
const mockFetchSuggestedQuestions = jest.fn();
const mockBuildRuntimeScopeHeaders = jest.fn();
const mockBuildRuntimeScopeUrl = jest.fn();
const mockResolveClientRuntimeScopeSelector = jest.fn();
const mockUseAuthSession = jest.fn();

let capturedPromptProps: any = null;

jest.mock('antd', () => {
  const React = jest.requireActual('react');

  const Input = ({ children, ...props }: any) =>
    React.createElement('input', props, children);
  Input.TextArea = ({ children, ...props }: any) =>
    React.createElement('textarea', props, children);

  const Button = ({ children, ...props }: any) =>
    React.createElement('button', props, children);

  const Modal = ({ visible, title, children, okText, cancelText }: any) =>
    visible
      ? React.createElement(
          'section',
          null,
          title,
          okText ? React.createElement('span', null, okText) : null,
          cancelText ? React.createElement('span', null, cancelText) : null,
          children,
        )
      : null;

  const Space = ({ children }: any) =>
    React.createElement('div', null, children);
  const Tag = ({ children }: any) =>
    React.createElement('span', null, children);
  const Alert = ({ message, description, children }: any) =>
    React.createElement('div', null, message, description, children);
  const Typography = {
    Text: ({ children }: any) => React.createElement('span', null, children),
    Title: ({ children }: any) => React.createElement('h2', null, children),
  };

  const message = {
    error: jest.fn(),
    info: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  };
  (globalThis as any).__homeIndexMessage = message;

  return {
    Button,
    Input,
    Modal,
    Space,
    Tag,
    Alert,
    Typography,
    message,
  };
});

jest.mock('@/components/pages/home/prompt', () => {
  const React = jest.requireActual('react');

  return React.forwardRef((props: any, ref: any) => {
    capturedPromptProps = props;
    React.useImperativeHandle(ref, () => ({
      submit: jest.fn(),
    }));
    return React.createElement('div', null, 'Prompt');
  });
});

jest.mock('@/components/reference/DolaAppShell', () => ({
  __esModule: true,
  default: ({ children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, children);
  },
}));

jest.mock('@/hooks/useHomeSidebar', () => ({
  __esModule: true,
  default: () => mockUseHomeSidebar(),
}));

jest.mock('@/hooks/useAskPrompt', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseAskPrompt(...args),
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

jest.mock('@/hooks/useAuthSession', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseAuthSession(...args),
}));

jest.mock('@/apollo/client/runtimeScope', () => ({
  buildRuntimeScopeHeaders: (...args: any[]) =>
    mockBuildRuntimeScopeHeaders(...args),
  buildRuntimeScopeUrl: (...args: any[]) => mockBuildRuntimeScopeUrl(...args),
  resolveClientRuntimeScopeSelector: (...args: any[]) =>
    mockResolveClientRuntimeScopeSelector(...args),
}));

jest.mock('@/utils/homeRest', () => {
  const actual = jest.requireActual('@/utils/homeRest');
  return {
    ...actual,
    fetchSuggestedQuestions: (...args: any[]) =>
      mockFetchSuggestedQuestions(...args),
  };
});

const renderPage = () => renderToStaticMarkup(React.createElement(HomePage));

const setHomeStateOverrides = (overrides: Partial<Record<number, any>>) => {
  let callIndex = 0;
  const spy = jest.spyOn(React, 'useState' as any) as jest.SpyInstance;
  return spy.mockImplementation(((initial: any) => {
    callIndex += 1;
    if (Object.prototype.hasOwnProperty.call(overrides, callIndex)) {
      return [overrides[callIndex], jest.fn()];
    }
    return [typeof initial === 'function' ? initial() : initial, jest.fn()];
  }) as any);
};

describe('home index page', () => {
  const mockAskSubmit = jest.fn();
  const mockOnStopPolling = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    clearHomeSkillOptionsCacheForTests();
    capturedPromptProps = null;
    mockResolveClientRuntimeScopeSelector.mockReturnValue({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
      runtimeScopeId: 'scope-1',
    });
    mockBuildRuntimeScopeHeaders.mockImplementation((selector: any) => {
      const headers: Record<string, string> = {};
      if (selector?.workspaceId) {
        headers['x-wren-workspace-id'] = selector.workspaceId;
      }
      if (selector?.knowledgeBaseId) {
        headers['x-wren-knowledge-base-id'] = selector.knowledgeBaseId;
      }
      if (selector?.kbSnapshotId) {
        headers['x-wren-kb-snapshot-id'] = selector.kbSnapshotId;
      }
      if (selector?.deployHash) {
        headers['x-wren-deploy-hash'] = selector.deployHash;
      }
      return headers;
    });
    mockBuildRuntimeScopeUrl.mockImplementation(
      (path: string, _query?: any, scope?: any) => {
        const params = new URLSearchParams();
        if (scope?.workspaceId) {
          params.set('workspaceId', scope.workspaceId);
        }
        if (scope?.knowledgeBaseId) {
          params.set('knowledgeBaseId', scope.knowledgeBaseId);
        }
        return params.toString() ? `${path}?${params.toString()}` : path;
      },
    );
    mockUseHomeSidebar.mockReturnValue({
      data: {
        threads: [{ id: 'thread-1', name: '最近一次经营分析' }],
      },
      onSelect: jest.fn(),
      refetch: jest.fn(),
    });
    mockUseAskPrompt.mockReturnValue({
      data: null,
      inputProps: {},
      onSubmit: mockAskSubmit,
      onStopPolling: mockOnStopPolling,
    });
    mockUseProtectedRuntimeScopePage.mockReturnValue({
      guarding: false,
      hasRuntimeScope: true,
    });
    mockUseRuntimeScopeNavigation.mockReturnValue({
      push: jest.fn(),
      pushWorkspace: jest.fn(),
      selector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        runtimeScopeId: 'scope-1',
      },
    });
    mockUseAuthSession.mockReturnValue({
      data: {
        user: {
          displayName: 'Nova User',
          email: 'nova@example.com',
        },
      },
    });
    mockUseRuntimeSelectorState.mockReturnValue({
      provided: true,
      loading: false,
      refetch: jest.fn(),
      runtimeSelectorState: {
        currentWorkspace: { id: 'ws-1', name: '系统工作空间' },
        currentKnowledgeBase: {
          id: 'kb-1',
          name: '订单分析知识库',
          defaultKbSnapshotId: 'snap-1',
        },
        currentKbSnapshot: {
          id: 'snap-1',
          displayName: '默认快照',
          deployHash: 'deploy-1',
          status: 'READY',
        },
        knowledgeBases: [
          {
            id: 'kb-1',
            name: '订单分析知识库',
            defaultKbSnapshotId: 'snap-1',
          },
          {
            id: 'kb-2',
            name: '客户经营知识库',
            defaultKbSnapshotId: 'snap-2',
          },
        ],
      },
    });
    mockFetchSuggestedQuestions.mockResolvedValue({
      questions: [
        { question: '最近 30 天 GMV 趋势' },
        { question: '订单量波动最大的类目' },
        { question: '复购率最高的用户群体' },
      ],
    });
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/skills/available?')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 'skill-1',
              name: '订单 SQL Skill',
              runtimeKind: 'text-to-sql',
              sourceType: 'database',
              connectorId: 'connector-1',
              kbSuggestionIds: ['kb-1'],
            },
          ],
        });
      }

      if (url.includes('/api/v1/asking-tasks?')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'task-1',
          }),
        });
      }

      if (url.includes('/api/v1/threads?')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'thread-2',
          }),
        });
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as any;
  });

  it('renders the new conversation composer and knowledge picker affordances', () => {
    const useStateSpy = setHomeStateOverrides({
      1: true,
    });

    const markup = renderPage();

    expect(markup).toContain('你好，Nova User');
    expect(markup).toContain('我是你的数据AI助手，我能为你做什么？');
    expect(markup).toContain('指定知识库');
    expect(markup).toContain('输入关键词搜索知识库');
    expect(markup).toContain('电商订单数据（E-commerce）');
    expect(markup).toContain('客户经营知识库');
    expect(markup).toContain('0 张表');
    expect(markup).toContain('案例广场');
    expect(markup).toContain('推荐模板');
    expect(markup).toContain('问题来自');
    expect(markup).toContain('订单量最高的 3 个城市分别是谁？');
    expect(markup).not.toContain('当前知识库');
    expect(markup).not.toContain('系统工作空间');
    expect(markup).not.toContain('确认范围');
    expect(renderToStaticMarkup(capturedPromptProps.footerContent)).toContain(
      '模式',
    );
    expect(renderToStaticMarkup(capturedPromptProps.footerContent)).toContain(
      '技能',
    );
    expect(renderToStaticMarkup(capturedPromptProps.footerContent)).toContain(
      '文件',
    );
    expect(mockUseAuthSession).toHaveBeenCalledWith({
      includeWorkspaceQuery: false,
    });

    useStateSpy.mockRestore();
  });

  it('renders removable pinned knowledge-base chips in composer scope row', () => {
    const useStateSpy = setHomeStateOverrides({
      3: ['kb-2'],
    });

    const markup = renderPage();

    expect(markup).toContain('客户经营知识库');
    expect(markup).toContain('aria-label="移除知识库 客户经营知识库"');

    useStateSpy.mockRestore();
  });

  it('shows sample-runtime source hint when selected knowledge base has no demo mapping', () => {
    const useStateSpy = setHomeStateOverrides({
      3: ['kb-2'],
      9: {
        questions: [
          { question: '最近 30 天 GMV 趋势' },
          { question: '订单量波动最大的类目' },
          { question: '复购率最高的用户群体' },
        ],
      },
    });

    const markup = renderPage();

    expect(markup).toContain('问题来自当前运行时的样例题库');

    useStateSpy.mockRestore();
  });

  it('shows selected knowledge-base demo source hint when pin matches demo mapping', () => {
    mockUseRuntimeSelectorState.mockReturnValue({
      provided: true,
      loading: false,
      refetch: jest.fn(),
      runtimeSelectorState: {
        currentWorkspace: { id: 'ws-1', name: '系统工作空间' },
        currentKnowledgeBase: {
          id: 'kb-1',
          name: '订单分析知识库',
        },
        knowledgeBases: [
          {
            id: 'kb-1',
            name: '订单分析知识库',
            defaultKbSnapshotId: 'snap-1',
          },
          {
            id: 'kb-2',
            name: '人力资源数据（HR）',
            defaultKbSnapshotId: 'snap-2',
          },
        ],
      },
    });

    const useStateSpy = setHomeStateOverrides({
      3: ['kb-2'],
    });

    const markup = renderPage();

    expect(markup).toContain('问题来自「人力资源数据（HR）」知识库的示例问题');

    useStateSpy.mockRestore();
  });

  it('creates a new ask flow without forcing a default knowledge base', async () => {
    const mockPush = jest.fn();
    mockUseRuntimeScopeNavigation.mockReturnValue({
      push: mockPush,
      pushWorkspace: mockPush,
      selector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        runtimeScopeId: 'scope-1',
      },
    });

    renderPage();
    expect(mockUseAskPrompt).toHaveBeenCalledWith(
      undefined,
      {
        knowledgeBaseIds: undefined,
        selectedSkillIds: undefined,
      },
      undefined,
      expect.objectContaining({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        runtimeScopeId: 'scope-1',
      }),
    );

    await capturedPromptProps.onSubmit('测试问题');

    expect(mockOnStopPolling).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/asking-tasks?workspaceId=ws-1&knowledgeBaseId=kb-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          question: '测试问题',
        }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/v1/threads?workspaceId=ws-1&knowledgeBaseId=kb-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          question: '测试问题',
          taskId: 'task-1',
        }),
      }),
    );
    expect(mockPush).toHaveBeenCalledWith(
      '/home/thread-2',
      {},
      expect.objectContaining({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
    );
  });

  it('warns instead of submitting when runtime is not deployed yet', async () => {
    mockUseRuntimeScopeNavigation.mockReturnValue({
      push: jest.fn(),
      pushWorkspace: jest.fn(),
      selector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: undefined,
        deployHash: undefined,
        runtimeScopeId: 'scope-1',
      },
    });
    mockUseRuntimeSelectorState.mockReturnValue({
      provided: true,
      loading: false,
      refetch: jest.fn(),
      runtimeSelectorState: {
        currentWorkspace: { id: 'ws-1', name: '系统工作空间' },
        currentKnowledgeBase: {
          id: 'kb-1',
          name: '订单分析知识库',
          defaultKbSnapshotId: undefined,
        },
        currentKbSnapshot: undefined,
        knowledgeBases: [
          {
            id: 'kb-1',
            name: '订单分析知识库',
            defaultKbSnapshotId: undefined,
          },
        ],
      },
    });

    renderPage();
    await capturedPromptProps.onSubmit('帮我查 GMV');

    expect((globalThis as any).__homeIndexMessage.warning).toHaveBeenCalledWith(
      '当前没有可用的知识库运行范围。',
    );
    expect(mockAskSubmit).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('blocks asking with historical snapshot readonly hint', async () => {
    mockUseRuntimeScopeNavigation.mockReturnValue({
      push: jest.fn(),
      pushWorkspace: jest.fn(),
      selector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-history',
        deployHash: 'deploy-history',
        runtimeScopeId: 'scope-1',
      },
    });
    mockUseRuntimeSelectorState.mockReturnValue({
      provided: true,
      loading: false,
      refetch: jest.fn(),
      runtimeSelectorState: {
        currentWorkspace: { id: 'ws-1', name: '系统工作空间' },
        currentKnowledgeBase: {
          id: 'kb-1',
          name: '订单分析知识库',
          defaultKbSnapshotId: 'snap-latest',
        },
        currentKbSnapshot: {
          id: 'snap-history',
          displayName: '历史快照',
        },
        knowledgeBases: [
          {
            id: 'kb-1',
            name: '订单分析知识库',
            defaultKbSnapshotId: 'snap-latest',
          },
        ],
      },
    });

    renderPage();
    await capturedPromptProps.onSubmit('帮我查 GMV');

    expect((globalThis as any).__homeIndexMessage.warning).toHaveBeenCalledWith(
      HISTORICAL_SNAPSHOT_READONLY_HINT,
    );
    expect(mockAskSubmit).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('persists selected skills together with multi knowledge-base scope', async () => {
    const useStateSpy = setHomeStateOverrides({
      3: ['kb-1', 'kb-2'],
      6: ['skill-1', 'skill-2'],
    });

    renderPage();

    expect(mockUseAskPrompt).toHaveBeenCalledWith(
      undefined,
      {
        knowledgeBaseIds: ['kb-1', 'kb-2'],
        selectedSkillIds: ['skill-1', 'skill-2'],
      },
      undefined,
      expect.objectContaining({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
    );

    await capturedPromptProps.onCreateResponse({
      question: '调用技能分析异常订单',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/threads?workspaceId=ws-1&knowledgeBaseId=kb-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          question: '调用技能分析异常订单',
          knowledgeBaseIds: ['kb-1', 'kb-2'],
          selectedSkillIds: ['skill-1', 'skill-2'],
        }),
      }),
    );

    useStateSpy.mockRestore();
  });

  it('switches ask runtime to the selected knowledge base before creating a thread', async () => {
    const mockPush = jest.fn();
    const useStateSpy = setHomeStateOverrides({
      3: ['kb-2'],
    });

    mockUseRuntimeScopeNavigation.mockReturnValue({
      push: mockPush,
      pushWorkspace: mockPush,
      selector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        runtimeScopeId: 'scope-1',
      },
    });

    renderPage();
    await capturedPromptProps.onSubmit('帮我看 HR 指标');

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/asking-tasks?workspaceId=ws-1&knowledgeBaseId=kb-2',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          question: '帮我看 HR 指标',
          knowledgeBaseIds: ['kb-2'],
        }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/v1/threads?workspaceId=ws-1&knowledgeBaseId=kb-2',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          question: '帮我看 HR 指标',
          taskId: 'task-1',
          knowledgeBaseIds: ['kb-2'],
        }),
      }),
    );
    expect(mockPush).toHaveBeenCalledWith(
      '/home/thread-2',
      {
        knowledgeBaseIds: 'kb-2',
      },
      {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-2',
      },
    );

    useStateSpy.mockRestore();
  });

  it('prefers the first selected knowledge base as the ask runtime scope', () => {
    expect(
      resolveAskRuntimeSelector({
        currentSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
        selectedKnowledgeBaseIds: ['kb-2', 'kb-3'],
        workspaceId: 'ws-1',
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-2',
    });

    expect(
      resolveAskRuntimeSelector({
        currentSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
        selectedKnowledgeBaseIds: [],
        workspaceId: 'ws-1',
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    });
  });

  it('only loads skill options when the skill picker is opened or skills are already selected', () => {
    expect(
      shouldLoadHomeSkillOptions({
        workspaceId: 'ws-1',
        hasExecutableRuntime: true,
        skillPickerOpen: false,
        selectedSkillCount: 0,
      }),
    ).toBe(false);

    expect(
      shouldLoadHomeSkillOptions({
        workspaceId: 'ws-1',
        hasExecutableRuntime: true,
        skillPickerOpen: true,
        selectedSkillCount: 0,
      }),
    ).toBe(true);

    expect(
      shouldLoadHomeSkillOptions({
        workspaceId: 'ws-1',
        hasExecutableRuntime: true,
        skillPickerOpen: false,
        selectedSkillCount: 1,
      }),
    ).toBe(true);
  });

  it('normalizes and sorts skill options payload consistently', () => {
    expect(
      normalizeHomeSkillOptions([
        {
          id: 'skill-2',
          name: 'zeta',
          runtimeKind: 'python',
          sourceType: 'custom',
          connectorId: 'connector-1',
          kbSuggestionIds: ['kb-2'],
        },
        {
          id: 'skill-1',
          name: 'alpha',
          runtimeKind: 'python',
          sourceType: 'built_in',
          connectorId: null,
          kbSuggestionIds: null,
        },
      ]),
    ).toEqual([
      {
        id: 'skill-1',
        name: 'alpha',
        runtimeKind: 'python',
        sourceType: 'built_in',
        knowledgeBaseIds: [],
        connectorCount: 0,
      },
      {
        id: 'skill-2',
        name: 'zeta',
        runtimeKind: 'python',
        sourceType: 'custom',
        knowledgeBaseIds: ['kb-2'],
        connectorCount: 1,
      },
    ]);
  });
});
