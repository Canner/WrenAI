import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ThreadPage, {
  findLatestPollableThreadResponse,
  findLatestUnfinishedAskingResponse,
} from '../../../pages/home/[id]';
import { HISTORICAL_SNAPSHOT_READONLY_HINT } from '../../../utils/runtimeSnapshot';

const mockUseRouter = jest.fn();
const mockUseHomeSidebar = jest.fn();
const mockUseAskPrompt = jest.fn();
const mockCanFetchThreadResponse = jest.fn();
const mockGetIsFinished = jest.fn();
const mockUseAdjustAnswer = jest.fn();
const mockUseModalAction = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseThreadDetail = jest.fn();
const mockUseCreateThreadResponseMutation = jest.fn();
const mockUseThreadResponsePolling = jest.fn();
const mockUseUpdateThreadResponseMutation = jest.fn();
const mockUseGenerateThreadRecommendationQuestionsMutation = jest.fn();
const mockUseThreadRecommendedQuestionsPolling = jest.fn();
const mockUseGenerateThreadResponseAnswerMutation = jest.fn();
const mockUseGenerateThreadResponseChartMutation = jest.fn();
const mockUseAdjustThreadResponseChartMutation = jest.fn();
const mockUsePreviewDataMutation = jest.fn();
const mockUseRuntimeSelectorState = jest.fn();
const mockCreateKnowledgeSqlPair = jest.fn();
const mockCreateViewFromResponse = jest.fn();

let mockThread: any;

jest.mock('next/router', () => ({
  useRouter: () => mockUseRouter(),
}));

jest.mock('antd', () => {
  const React = jest.requireActual('react');
  const message = {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
  };
  (globalThis as any).__homeThreadMessage = message;
  return {
    Empty: ({ children }: any) =>
      React.createElement('div', null, children || 'Empty'),
    Tabs: ({ items }: any) =>
      React.createElement(
        'div',
        null,
        (items || []).map((item: any) =>
          React.createElement(
            'section',
            { key: item.key },
            item.label,
            item.children,
          ),
        ),
      ),
    Typography: {
      Text: ({ children }: any) => React.createElement('span', null, children),
      Title: ({ children }: any) => React.createElement('h2', null, children),
    },
    message,
  };
});

jest.mock('@/hooks/useHomeSidebar', () => ({
  __esModule: true,
  default: () => mockUseHomeSidebar(),
}));

jest.mock('@/hooks/useAskPrompt', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseAskPrompt(...args),
  getIsFinished: (...args: any[]) => mockGetIsFinished(...args),
  canFetchThreadResponse: (...args: any[]) =>
    mockCanFetchThreadResponse(...args),
  isRecommendedFinished: () => true,
}));

jest.mock('@/hooks/useAdjustAnswer', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseAdjustAnswer(...args),
}));

jest.mock('@/hooks/useModalAction', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseModalAction(...args),
}));

jest.mock('@/components/pages/home/prompt', () => {
  const React = jest.requireActual('react');
  return {
    __esModule: true,
    default: React.forwardRef((_props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        close: jest.fn(),
        submit: jest.fn(),
      }));
      return React.createElement('div', null, 'Prompt');
    }),
  };
});

jest.mock('@/components/pages/home/promptThread', () => ({
  __esModule: true,
  default: () => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, 'PromptThread');
  },
}));

jest.mock('@/components/pages/home/promptThread/ChartAnswer', () => ({
  __esModule: true,
  default: () => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, 'ChartAnswer');
  },
  getIsChartFinished: () => true,
}));

jest.mock('@/components/pages/home/promptThread/TextBasedAnswer', () => ({
  getAnswerIsFinished: () => true,
}));

jest.mock('@/components/pages/home/promptThread/ViewSQLTabContent', () => ({
  __esModule: true,
  default: () => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, 'ViewSQLTabContent');
  },
}));

jest.mock('@/components/pages/home/promptThread/store', () => ({
  __esModule: true,
  PromptThreadProvider: ({ children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, children);
  },
}));

jest.mock('@/components/reference/ConsoleShellLayout', () => ({
  __esModule: true,
  default: ({ title, description, titleExtra, children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement(
      'div',
      null,
      title,
      description,
      titleExtra,
      children,
    );
  },
}));

jest.mock('@/components/modals/SaveAsViewModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/modals/QuestionSQLPairModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/modals/AdjustReasoningStepsModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/modals/AdjustSQLModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/dataPreview/PreviewData', () => ({
  __esModule: true,
  default: () => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, 'PreviewData');
  },
}));

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

jest.mock('@/hooks/useProtectedRuntimeScopePage', () => ({
  __esModule: true,
  default: () => mockUseProtectedRuntimeScopePage(),
}));

jest.mock('@/hooks/useThreadDetail', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseThreadDetail(...args),
}));

jest.mock('@/hooks/useThreadResponsePolling', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseThreadResponsePolling(...args),
}));

jest.mock('@/hooks/useThreadRecommendedQuestionsPolling', () => ({
  __esModule: true,
  default: (...args: any[]) =>
    mockUseThreadRecommendedQuestionsPolling(...args),
}));

jest.mock('@/apollo/client/graphql/home.generated', () => ({
  useCreateThreadResponseMutation: (...args: any[]) =>
    mockUseCreateThreadResponseMutation(...args),
  useUpdateThreadResponseMutation: (...args: any[]) =>
    mockUseUpdateThreadResponseMutation(...args),
  useGenerateThreadRecommendationQuestionsMutation: (...args: any[]) =>
    mockUseGenerateThreadRecommendationQuestionsMutation(...args),
  useGenerateThreadResponseAnswerMutation: (...args: any[]) =>
    mockUseGenerateThreadResponseAnswerMutation(...args),
  useGenerateThreadResponseChartMutation: (...args: any[]) =>
    mockUseGenerateThreadResponseChartMutation(...args),
  useAdjustThreadResponseChartMutation: (...args: any[]) =>
    mockUseAdjustThreadResponseChartMutation(...args),
  usePreviewDataMutation: (...args: any[]) =>
    mockUsePreviewDataMutation(...args),
}));

jest.mock('@/hooks/useRuntimeSelectorState', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseRuntimeSelectorState(...args),
}));

jest.mock('@/utils/knowledgeRuleSqlRest', () => ({
  createKnowledgeSqlPair: (...args: any[]) =>
    mockCreateKnowledgeSqlPair(...args),
}));

jest.mock('@/utils/viewRest', () => ({
  createViewFromResponse: (...args: any[]) =>
    mockCreateViewFromResponse(...args),
}));

const renderPage = () => renderToStaticMarkup(React.createElement(ThreadPage));

describe('home/[id] thread shell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanFetchThreadResponse.mockReturnValue(false);
    mockGetIsFinished.mockImplementation((status?: string) =>
      ['FINISHED', 'FAILED', 'STOPPED'].includes(`${status ?? ''}`),
    );
    mockThread = {
      id: 42,
      name: '经营分析线程',
      knowledgeBaseIds: ['kb-1', 'kb-2'],
      selectedSkillIds: [],
      responses: [],
    };

    mockUseRouter.mockReturnValue({
      query: { id: '42', knowledgeBaseIds: 'kb-1,kb-2' },
      isReady: true,
    });
    mockUseHomeSidebar.mockReturnValue({
      data: { threads: [{ id: '42', name: '经营分析线程' }] },
      onSelect: jest.fn(),
      refetch: jest.fn(),
    });
    mockUseAskPrompt.mockReturnValue({
      inputProps: {},
      onSubmit: jest.fn(),
      onStopPolling: jest.fn(),
      onFetching: jest.fn(),
      onStoreThreadQuestions: jest.fn(),
    });
    mockUseAdjustAnswer.mockReturnValue({
      loading: false,
      onStop: jest.fn(),
      onReRun: jest.fn(),
      onAdjustReasoningSteps: jest.fn(),
      onAdjustSQL: jest.fn(),
    });
    mockUseModalAction.mockReturnValue({
      state: { visible: false },
      openModal: jest.fn(),
      closeModal: jest.fn(),
    });
    mockUseRuntimeScopeNavigation.mockReturnValue({
      push: jest.fn(),
      selector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        runtimeScopeId: 'scope-1',
      },
      hasRuntimeScope: true,
    });
    mockUseProtectedRuntimeScopePage.mockReturnValue({
      guarding: false,
      hasRuntimeScope: true,
    });
    mockUseThreadDetail.mockReturnValue({
      data: { thread: mockThread },
      loading: false,
      updateQuery: jest.fn(),
    });
    mockUseCreateThreadResponseMutation.mockReturnValue([jest.fn()]);
    mockUseThreadResponsePolling.mockReturnValue({
      data: null,
      fetchById: jest.fn(),
      stopPolling: jest.fn(),
    });
    mockUseUpdateThreadResponseMutation.mockReturnValue([
      jest.fn(),
      { loading: false },
    ]);
    mockUseGenerateThreadRecommendationQuestionsMutation.mockReturnValue([
      jest.fn(),
    ]);
    mockUseThreadRecommendedQuestionsPolling.mockReturnValue({
      data: null,
      fetchByThreadId: jest.fn(),
      stopPolling: jest.fn(),
    });
    mockUseGenerateThreadResponseAnswerMutation.mockReturnValue([jest.fn()]);
    mockUseGenerateThreadResponseChartMutation.mockReturnValue([jest.fn()]);
    mockUseAdjustThreadResponseChartMutation.mockReturnValue([jest.fn()]);
    mockUsePreviewDataMutation.mockReturnValue([
      jest.fn(),
      { data: undefined, loading: false },
    ]);
    mockUseRuntimeSelectorState.mockReturnValue({
      runtimeSelectorState: {
        currentWorkspace: { id: 'ws-1', name: '系统工作空间' },
        currentKnowledgeBase: { id: 'kb-1', name: '订单知识库' },
        knowledgeBases: [
          { id: 'kb-1', name: '订单知识库' },
          { id: 'kb-2', name: '客户知识库' },
        ],
      },
      loading: false,
      refetch: jest.fn(),
    });
    mockCreateKnowledgeSqlPair.mockResolvedValue({ id: 1 });
    mockCreateViewFromResponse.mockResolvedValue({
      id: 1,
      name: 'sales_view',
      statement: 'select 1',
      displayName: '销售视图',
    });
  });

  it('renders the historical knowledge bases once inside the conversation shell', () => {
    const markup = renderPage();

    expect(markup).toContain('电商订单数据（E-commerce）');
    expect(markup).toContain('客户知识库');
    expect(markup).toContain('PromptThread');
    expect(markup).toContain('Prompt');
    expect(markup).not.toContain('标准模式');
    expect(markup).not.toContain('技能模式');
    expect(markup).not.toContain('当前线程已固定绑定');
    expect(markup).not.toContain('已绑定知识库');
    expect(markup.split('电商订单数据（E-commerce）')).toHaveLength(2);
    expect(markup.split('客户知识库')).toHaveLength(2);
  });

  it('keeps the shell clean even when the thread has selected skills', () => {
    mockThread = {
      ...mockThread,
      selectedSkillIds: ['skill-1', 'skill-2'],
    };
    mockUseThreadDetail.mockReturnValue({
      data: { thread: mockThread },
      loading: false,
      updateQuery: jest.fn(),
    });

    const markup = renderPage();

    expect(markup).not.toContain('技能模式');
    expect(markup).not.toContain('保持在当前知识库范围内继续追问');
  });

  it('renders blocked composer guidance when runtime is unavailable', () => {
    mockUseRuntimeScopeNavigation.mockReturnValue({
      push: jest.fn(),
      selector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        runtimeScopeId: null,
        kbSnapshotId: null,
        deployHash: null,
      },
      hasRuntimeScope: true,
    });

    const markup = renderPage();

    expect(markup).toContain(
      '当前知识库暂不可继续追问，请先确认已接入可用数据资产。',
    );
    expect(markup).not.toContain('当前工作空间还没有可执行知识库版本');
    expect(markup).not.toContain('去完善知识库');
  });

  it('shows readonly guidance when viewing a historical snapshot', () => {
    mockUseRuntimeScopeNavigation.mockReturnValue({
      push: jest.fn(),
      selector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        runtimeScopeId: 'scope-1',
        kbSnapshotId: 'snap-history',
        deployHash: 'deploy-history',
      },
      hasRuntimeScope: true,
    });
    mockUseRuntimeSelectorState.mockReturnValue({
      runtimeSelectorState: {
        currentWorkspace: { id: 'ws-1', name: '系统工作空间' },
        currentKnowledgeBase: {
          id: 'kb-1',
          name: '订单知识库',
          defaultKbSnapshotId: 'snap-latest',
        },
        currentKbSnapshot: {
          id: 'snap-history',
          displayName: '历史快照',
        },
        knowledgeBases: [
          { id: 'kb-1', name: '订单知识库' },
          { id: 'kb-2', name: '客户知识库' },
        ],
      },
      loading: false,
      refetch: jest.fn(),
    });

    const markup = renderPage();

    expect(markup).toContain(HISTORICAL_SNAPSHOT_READONLY_HINT);
    expect(markup).not.toContain(
      '当前知识库暂不可继续追问，请先确认已接入可用数据资产。',
    );
    expect(markup).not.toContain('<div>Prompt</div>');
  });

  it('does not trigger SQL pair persistence during initial render', () => {
    renderPage();

    expect(mockCreateKnowledgeSqlPair).not.toHaveBeenCalled();
  });

  it('prefers the latest unfinished asking response when resuming polling', () => {
    const next = findLatestUnfinishedAskingResponse([
      {
        id: 1,
        askingTask: { queryId: 'task-1', status: 'PLANNING' },
      } as any,
      {
        id: 2,
        askingTask: { queryId: 'task-2', status: 'SEARCHING' },
      } as any,
    ]);

    expect(next?.id).toBe(2);
  });

  it('prefers the latest pollable response to avoid restarting stale ones', () => {
    mockCanFetchThreadResponse.mockReturnValue(true);

    const next = findLatestPollableThreadResponse([
      { id: 11, askingTask: { status: 'FINISHED' } } as any,
      { id: 12, askingTask: { status: 'FINISHED' } } as any,
    ]);

    expect(next?.id).toBe(12);
    expect(mockCanFetchThreadResponse).toHaveBeenCalled();
  });

  it('does not keep polling a SQL-only response that is already renderable', () => {
    mockCanFetchThreadResponse.mockReturnValue(true);

    const next = findLatestPollableThreadResponse([
      {
        id: 21,
        sql: 'select 1',
        askingTask: { status: 'FINISHED' },
        answerDetail: {},
        chartDetail: null,
      } as any,
    ]);

    expect(next).toBeUndefined();
  });
});
