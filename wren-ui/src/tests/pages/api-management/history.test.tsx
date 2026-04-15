import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import moment from 'moment';
import APIHistory from '../../../pages/api-management/history';
import { ApiType } from '@/apollo/client/graphql/__types__';
import { API_HISTORY_FILTER_TYPES } from '@/components/pages/apiManagement/apiTypeLabels';

const mockUseRouter = jest.fn();
const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseDrawerAction = jest.fn();
const mockUseApiHistoryQuery = jest.fn();
const mockUseAskShadowCompareStatsQuery = jest.fn();

let mockCapturedTableProps: any;
let mockCapturedRangePickerProps: any;

jest.mock('next/router', () => ({
  useRouter: () => mockUseRouter(),
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

  return {
    Alert: ({ children }: any) => React.createElement('div', null, children),
    Button: ({ children }: any) =>
      React.createElement('button', null, children),
    DatePicker: {
      RangePicker: (props: any) => {
        mockCapturedRangePickerProps = props;
        return React.createElement('div', { 'data-kind': 'range-picker' });
      },
    },
    Space: ({ children }: any) => React.createElement('div', null, children),
    Table: (props: any) => {
      mockCapturedTableProps = props;
      return React.createElement('div', { 'data-kind': 'table' });
    },
    Tag: ({ children }: any) => React.createElement('span', null, children),
    Typography: {
      Text: ({ children }: any) => React.createElement('span', null, children),
    },
  };
});

jest.mock('@/utils/table', () => ({
  getColumnSearchProps: ({ filteredValue }: any) => ({ filteredValue }),
}));

jest.mock('@/utils/time', () => ({
  getAbsoluteTime: (value: string) => value,
}));

jest.mock('@/hooks/useProtectedRuntimeScopePage', () => ({
  __esModule: true,
  default: () => mockUseProtectedRuntimeScopePage(),
}));

jest.mock('@/hooks/useDrawerAction', () => ({
  __esModule: true,
  default: () => mockUseDrawerAction(),
}));

jest.mock('@/apollo/client/graphql/apiManagement.generated', () => ({
  useApiHistoryQuery: (args: any) => mockUseApiHistoryQuery(args),
  useAskShadowCompareStatsQuery: (args: any) =>
    mockUseAskShadowCompareStatsQuery(args),
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

jest.mock('@/components/code/SQLCodeBlock', () => ({
  __esModule: true,
  default: () => {
    const React = jest.requireActual('react');
    return React.createElement('pre', null, 'sql');
  },
}));

jest.mock('@/components/pages/apiManagement/DetailsDrawer', () => ({
  __esModule: true,
  default: () => {
    const React = jest.requireActual('react');
    return React.createElement('div', { 'data-kind': 'details-drawer' });
  },
}));

jest.mock('@/components/pages/apiManagement/ShadowCompareSummary', () => ({
  __esModule: true,
  default: () => {
    const React = jest.requireActual('react');
    return React.createElement('div', { 'data-kind': 'shadow-summary' });
  },
}));

jest.mock('@/components/pages/apiManagement/AskDiagnosticsSummary', () => ({
  __esModule: true,
  default: () => {
    const React = jest.requireActual('react');
    return React.createElement('div', {
      'data-kind': 'ask-diagnostics-summary',
    });
  },
}));

jest.mock('@ant-design/icons/ApiOutlined', () => () => 'api-icon');
jest.mock('@ant-design/icons/EyeOutlined', () => () => 'eye-icon');
jest.mock('@ant-design/icons/CheckCircleOutlined', () => () => 'check-icon');
jest.mock('@ant-design/icons/CloseCircleOutlined', () => () => 'close-icon');

const buildRouter = (query: Record<string, any>) => {
  const search = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      search.set(key, `${value}`);
    }
  });

  return {
    pathname: '/api-management/history',
    asPath: search.toString()
      ? `/api-management/history?${search.toString()}`
      : '/api-management/history',
    query,
    isReady: true,
    replace: jest.fn().mockResolvedValue(true),
  };
};

const readQueryFromUrl = (url: string) =>
  Object.fromEntries(new URL(url, 'http://wren.local').searchParams.entries());

const renderPage = () => renderToStaticMarkup(React.createElement(APIHistory));

describe('APIHistory page URL sync', () => {
  beforeEach(() => {
    mockCapturedTableProps = undefined;
    mockCapturedRangePickerProps = undefined;
    jest.clearAllMocks();

    mockUseProtectedRuntimeScopePage.mockReturnValue({
      guarding: false,
      hasRuntimeScope: true,
    });
    mockUseDrawerAction.mockReturnValue({
      state: { visible: false, defaultValue: null },
      openDrawer: jest.fn(),
      closeDrawer: jest.fn(),
    });
    mockUseApiHistoryQuery.mockReturnValue({
      data: { apiHistory: { items: [], total: 0 } },
      loading: false,
    });
    mockUseAskShadowCompareStatsQuery.mockReturnValue({
      data: { askShadowCompareStats: null },
      loading: false,
      error: undefined,
    });
  });

  it('restores page filters and date range from router query', () => {
    const router = buildRouter({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'hash-1',
      page: '3',
      apiType: ApiType.STREAM_ASK,
      statusCode: '400',
      threadId: 'thread-123',
      startDate: '2026-04-01',
      endDate: '2026-04-03',
    });
    mockUseRouter.mockReturnValue(router);

    renderPage();

    const expectedStartDate = moment('2026-04-01', 'YYYY-MM-DD', true)
      .startOf('day')
      .toISOString();
    const expectedEndDate = moment('2026-04-03', 'YYYY-MM-DD', true)
      .endOf('day')
      .toISOString();

    expect(mockUseApiHistoryQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          pagination: { offset: 20, limit: 10 },
          filter: expect.objectContaining({
            apiType: ApiType.STREAM_ASK,
            statusCode: 400,
            threadId: 'thread-123',
            startDate: expectedStartDate,
            endDate: expectedEndDate,
          }),
        }),
      }),
    );
    expect(mockCapturedTableProps.pagination.current).toBe(3);
    expect(
      mockCapturedTableProps.columns.find(
        (column: any) => column.key === 'apiType',
      ).filteredValue,
    ).toEqual([ApiType.STREAM_ASK]);
    expect(
      mockCapturedTableProps.columns.find(
        (column: any) => column.key === 'statusCode',
      ).filteredValue,
    ).toEqual([400]);
    expect(
      mockCapturedTableProps.columns.find(
        (column: any) => column.key === 'threadId',
      ).filteredValue,
    ).toEqual(['thread-123']);
    expect(mockCapturedRangePickerProps.value[0].format('YYYY-MM-DD')).toBe(
      '2026-04-01',
    );
    expect(mockCapturedRangePickerProps.value[1].format('YYYY-MM-DD')).toBe(
      '2026-04-03',
    );
  });

  it('updates router query when table pagination and filters change', () => {
    const router = buildRouter({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'hash-1',
      foo: 'bar',
    });
    mockUseRouter.mockReturnValue(router);

    renderPage();
    mockCapturedTableProps.onChange(
      { current: 2 },
      {
        apiType: [ApiType.ASK],
        statusCode: ['500'],
        threadId: ['thread-456'],
      },
      null,
    );

    expect(router.replace).toHaveBeenCalledTimes(1);
    const [nextUrl, _as, options] = router.replace.mock.calls[0];
    expect(options).toEqual({ shallow: true, scroll: false });
    expect(readQueryFromUrl(nextUrl)).toEqual({
      foo: 'bar',
      page: '2',
      apiType: ApiType.ASK,
      statusCode: '500',
      threadId: 'thread-456',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'hash-1',
    });
  });

  it('updates date range in router query and resets pagination to first page', () => {
    const router = buildRouter({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'hash-1',
      foo: 'bar',
      page: '4',
      apiType: ApiType.ASK,
      statusCode: '200',
      threadId: 'thread-999',
    });
    mockUseRouter.mockReturnValue(router);

    renderPage();
    mockCapturedRangePickerProps.onChange([
      moment('2026-04-10', 'YYYY-MM-DD', true),
      moment('2026-04-12', 'YYYY-MM-DD', true),
    ]);

    expect(router.replace).toHaveBeenCalledTimes(1);
    const [nextUrl] = router.replace.mock.calls[0];
    expect(readQueryFromUrl(nextUrl)).toEqual({
      foo: 'bar',
      apiType: ApiType.ASK,
      statusCode: '200',
      threadId: 'thread-999',
      startDate: '2026-04-10',
      endDate: '2026-04-12',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'hash-1',
    });
  });

  it('clears managed date params from router query when range is removed', () => {
    const router = buildRouter({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'hash-1',
      foo: 'bar',
      page: '2',
      apiType: ApiType.STREAM_ASK,
      startDate: '2026-04-01',
      endDate: '2026-04-03',
    });
    mockUseRouter.mockReturnValue(router);

    renderPage();
    mockCapturedRangePickerProps.onChange(null);

    expect(router.replace).toHaveBeenCalledTimes(1);
    const [nextUrl] = router.replace.mock.calls[0];
    expect(readQueryFromUrl(nextUrl)).toEqual({
      foo: 'bar',
      apiType: ApiType.STREAM_ASK,
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'hash-1',
    });
  });

  it('does not expose retired skill runner api types in filter options', () => {
    const router = buildRouter({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'hash-1',
    });
    mockUseRouter.mockReturnValue(router);

    renderPage();

    const apiTypeColumn = mockCapturedTableProps.columns.find(
      (column: any) => column.key === 'apiType',
    );

    expect(API_HISTORY_FILTER_TYPES).not.toContain('TEST_SKILL' as any);
    expect(apiTypeColumn.filters).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'test_skill',
        }),
      ]),
    );
  });
});
