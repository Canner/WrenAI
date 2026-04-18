import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import moment, { Moment } from 'moment';
import {
  Button,
  DatePicker,
  message,
  Table,
  TableColumnsType,
  Tag,
  Typography,
} from 'antd';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import CloseCircleOutlined from '@ant-design/icons/CloseCircleOutlined';
import EyeOutlined from '@ant-design/icons/EyeOutlined';
import styled from 'styled-components';
import SQLCodeBlock from '@/components/code/SQLCodeBlock';
import DetailsDrawer from '@/components/pages/apiManagement/DetailsDrawer';
import AskDiagnosticsSummary from '@/components/pages/apiManagement/AskDiagnosticsSummary';
import { ApiType } from '@/types/apiHistory';

import {
  buildRuntimeScopeUrl,
  omitRuntimeScopeQuery,
  readRuntimeScopeSelectorFromObject,
} from '@/runtime/client/runtimeScope';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useDrawerAction from '@/hooks/useDrawerAction';
import {
  ApiHistoryTableFilters,
  buildApiHistoryQueryParams,
  normalizeApiHistoryTableFilters,
  omitApiHistoryManagedQuery,
  readApiHistoryQueryState,
} from '@/components/pages/apiManagement/historyQuery';
import {
  ApiHistoryDateRange,
  buildApiHistoryDateFilter,
  getApiHistoryDateRangePresets,
  hasApiHistoryDateRange,
} from '@/components/pages/apiManagement/timeRange';
import {
  API_HISTORY_FILTER_TYPES,
  formatApiTypeLabel,
} from '@/components/pages/apiManagement/apiTypeLabels';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { Path } from '@/utils/enum';
import { getColumnSearchProps } from '@/utils/table';
import { getAbsoluteTime } from '@/utils/time';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { buildNovaSettingsNavItems } from '@/components/reference/novaShellNavigation';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useApiHistoryList, {
  type ApiHistoryListItem,
} from '@/hooks/useApiHistoryList';

const PAGE_SIZE = 10;

const RangeToolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(15, 23, 42, 0.06);
`;

export default function SettingsDiagnosticsPage() {
  const router = useRouter();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const authSession = useAuthSession();
  const showPlatformManagement = Boolean(
    authSession.data?.authorization?.actor?.platformRoleKeys?.includes(
      'platform_admin',
    ) ||
      authSession.data?.authorization?.actor?.isPlatformAdmin ||
      authSession.data?.isPlatformAdmin,
  );
  const detailsDrawer = useDrawerAction();
  const runtimeScopeSelector = useMemo(
    () => readRuntimeScopeSelectorFromObject(router.query),
    [router.query],
  );
  const { currentPage, filters, dateRange } = useMemo(
    () => readApiHistoryQueryState(router.query),
    [router.query],
  );

  const selectedApiType = filters['apiType']?.[0] as ApiType | undefined;
  const selectedStatusCode = filters['statusCode']?.[0] as number | undefined;
  const selectedThreadId = filters['threadId']?.[0] as string | undefined;
  const dateFilter = useMemo(
    () => buildApiHistoryDateFilter(dateRange),
    [dateRange],
  );

  const syncHistoryQuery = useCallback(
    ({
      currentPage,
      filters,
      dateRange,
    }: {
      currentPage: number;
      filters: ApiHistoryTableFilters;
      dateRange: ApiHistoryDateRange;
    }) => {
      if (!router.isReady) {
        return;
      }

      const baseQuery = omitApiHistoryManagedQuery(
        omitRuntimeScopeQuery(router.query),
      );
      const nextUrl = buildRuntimeScopeUrl(
        router.pathname,
        {
          ...baseQuery,
          ...buildApiHistoryQueryParams({
            currentPage,
            filters,
            dateRange,
          }),
        },
        runtimeScopeSelector,
      );

      if (nextUrl === router.asPath) {
        return;
      }

      void router.replace(nextUrl, undefined, {
        shallow: true,
        scroll: false,
      });
    },
    [router, runtimeScopeSelector],
  );

  const { data, loading } = useApiHistoryList({
    enabled: runtimeScopePage.hasRuntimeScope && router.isReady,
    pagination: {
      offset: (currentPage - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    },
    filter: {
      apiType: filters['apiType']?.[0],
      statusCode: filters['statusCode']?.[0],
      threadId: filters['threadId']?.[0],
      ...dateFilter,
    },
    runtimeScopeSelector,
    onError: (error) => {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载调用历史失败，请稍后重试。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    },
  });

  const columns: TableColumnsType<ApiHistoryListItem> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (timestamp: string) => (
        <div className="gray-7">{getAbsoluteTime(timestamp)}</div>
      ),
    },
    {
      title: 'API 类型',
      dataIndex: 'apiType',
      key: 'apiType',
      width: 220,
      render: (type: ApiHistoryListItem['apiType']) => (
        <Tag className="gray-8">{formatApiTypeLabel(type)}</Tag>
      ),
      filters: API_HISTORY_FILTER_TYPES.map((type) => ({
        text: formatApiTypeLabel(type),
        value: type,
      })),
      filteredValue: filters['apiType'],
      filterMultiple: false,
    },
    {
      title: '状态',
      dataIndex: 'statusCode',
      key: 'statusCode',
      width: 100,
      render: (status: number) => {
        const icon =
          status >= 200 && status < 300 ? (
            <CheckCircleOutlined />
          ) : (
            <CloseCircleOutlined />
          );
        const color = status >= 200 && status < 300 ? 'success' : 'error';
        return (
          <Tag icon={icon} color={color}>
            {status}
          </Tag>
        );
      },
      filters: [
        { text: '成功（2xx）', value: 200 },
        { text: '客户端错误（4xx）', value: 400 },
        { text: '服务端错误（5xx）', value: 500 },
      ],
      filteredValue: filters['statusCode'],
      filterMultiple: false,
    },
    {
      title: '问题 / SQL',
      dataIndex: 'requestPayload',
      key: 'requestPayload',
      render: (payload: Record<string, any>, record: ApiHistoryListItem) => {
        if (record.apiType === ApiType.RUN_SQL && payload.sql) {
          return (
            <div style={{ width: '100%' }}>
              <SQLCodeBlock code={payload.sql} maxHeight="130" />
            </div>
          );
        }
        return (
          <div className="gray-8">
            {payload?.question || payload?.sql || '-'}
          </div>
        );
      },
    },
    {
      title: '线程 ID',
      dataIndex: 'threadId',
      key: 'threadId',
      width: 200,
      render: (threadId: string) => {
        if (!threadId) return <div className="gray-7">-</div>;
        return (
          <Typography.Text
            ellipsis
            className="gray-7"
            copyable={{ text: threadId }}
          >
            {threadId}
          </Typography.Text>
        );
      },
      ...getColumnSearchProps({
        dataIndex: 'threadId',
        placeholder: '线程 ID',
        filteredValue: filters['threadId'],
      }),
    },
    {
      title: '诊断',
      dataIndex: 'responsePayload',
      key: 'diagnostics',
      width: 220,
      render: (responsePayload: Record<string, any>, record) => (
        <AskDiagnosticsSummary
          apiType={record.apiType as ApiType | null | undefined}
          responsePayload={responsePayload}
        />
      ),
    },
    {
      title: '耗时（ms）',
      dataIndex: 'durationMs',
      key: 'durationMs',
      width: 124,
      render: (durationMs: number) => (
        <div className="gray-7 text-right">{durationMs || '-'}</div>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      align: 'center',
      fixed: 'right',
      render: (record) => (
        <Button
          className="gray-8"
          type="text"
          size="small"
          onClick={() => detailsDrawer.openDrawer(record)}
        >
          <EyeOutlined /> 查看详情
        </Button>
      ),
    },
  ];

  const handleDateRangeChange = (
    nextDateRange: [Moment | null, Moment | null] | null,
  ) => {
    if (!nextDateRange?.[0] || !nextDateRange?.[1]) {
      syncHistoryQuery({
        currentPage: 1,
        filters,
        dateRange: null,
      });
      return;
    }

    syncHistoryQuery({
      currentPage: 1,
      filters,
      dateRange: [nextDateRange[0], nextDateRange[1]],
    });
  };

  if (runtimeScopePage.guarding) {
    return (
      <ConsoleShellLayout
        title="调用诊断"
        loading
        navItems={buildNovaSettingsNavItems({
          activeKey: 'settingsDiagnostics',
          onNavigate: runtimeScopeNavigation.pushWorkspace,
          showPlatformAdmin: showPlatformManagement,
        })}
        hideHistorySection
        sidebarBackAction={{
          label: '返回主菜单',
          onClick: () => runtimeScopeNavigation.pushWorkspace(Path.Home),
        }}
      />
    );
  }

  const items = data?.items || [];

  return (
    <ConsoleShellLayout
      title="调用诊断"
      description="查看 API History 与 Ask 诊断。"
      eyebrow="Diagnostics"
      navItems={buildNovaSettingsNavItems({
        activeKey: 'settingsDiagnostics',
        onNavigate: runtimeScopeNavigation.pushWorkspace,
        showPlatformAdmin: showPlatformManagement,
      })}
      hideHistorySection
      hideHeader
      contentBorderless
      sidebarBackAction={{
        label: '返回主菜单',
        onClick: () => runtimeScopeNavigation.pushWorkspace(Path.Home),
      }}
    >
      <RangeToolbar style={{ marginBottom: 16 }}>
        <Typography.Text className="gray-7">时间范围</Typography.Text>
        <DatePicker.RangePicker
          allowClear
          value={dateRange as any}
          ranges={getApiHistoryDateRangePresets(moment()) as any}
          onChange={handleDateRangeChange as any}
        />
        <Button
          type="link"
          size="small"
          onClick={() => handleDateRangeChange(null)}
          disabled={!hasApiHistoryDateRange(dateRange)}
        >
          重置
        </Button>
        <Typography.Text className="gray-7">
          当前页 {items.length} 条 / 总计 {data?.total ?? '—'} 条
        </Typography.Text>
      </RangeToolbar>

      <section className="console-panel">
        <div className="console-panel-header">
          <div>
            <div className="console-panel-title">调用明细</div>
            <div className="console-panel-subtitle">
              当前筛选：
              {selectedApiType ? formatApiTypeLabel(selectedApiType) : '全部'}
              {selectedThreadId ? ` · 线程 ${selectedThreadId}` : ''}
              {selectedStatusCode ? ` · 状态码 ${selectedStatusCode}+` : ''}
            </div>
          </div>
        </div>

        <Table
          className="console-table"
          dataSource={items}
          loading={loading || !router.isReady}
          columns={columns}
          rowKey="id"
          pagination={{
            current: currentPage,
            hideOnSinglePage: true,
            pageSize: PAGE_SIZE,
            size: 'small',
            total: data?.total,
          }}
          scroll={{ x: 1420 }}
          onChange={(pagination, nextFilters) => {
            syncHistoryQuery({
              currentPage: pagination.current || 1,
              filters: normalizeApiHistoryTableFilters(nextFilters),
              dateRange,
            });
          }}
        />
      </section>

      <DetailsDrawer
        {...detailsDrawer.state}
        onClose={detailsDrawer.closeDrawer}
      />
    </ConsoleShellLayout>
  );
}
