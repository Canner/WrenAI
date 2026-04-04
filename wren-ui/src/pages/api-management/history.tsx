import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import moment, { Moment } from 'moment';
import {
  Alert,
  Button,
  DatePicker,
  Space,
  Table,
  TableColumnsType,
  Tag,
  Typography,
} from 'antd';
import { getAbsoluteTime } from '@/utils/time';
import useDrawerAction from '@/hooks/useDrawerAction';
import { getColumnSearchProps } from '@/utils/table';
import SiderLayout from '@/components/layouts/SiderLayout';
import PageLayout from '@/components/layouts/PageLayout';
import ApiOutlined from '@ant-design/icons/ApiOutlined';
import EyeOutlined from '@ant-design/icons/EyeOutlined';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import CloseCircleOutlined from '@ant-design/icons/CloseCircleOutlined';
import SQLCodeBlock from '@/components/code/SQLCodeBlock';
import DetailsDrawer from '@/components/pages/apiManagement/DetailsDrawer';
import ShadowCompareSummary from '@/components/pages/apiManagement/ShadowCompareSummary';
import AskDiagnosticsSummary from '@/components/pages/apiManagement/AskDiagnosticsSummary';
import {
  useApiHistoryQuery,
  useAskShadowCompareStatsQuery,
} from '@/apollo/client/graphql/apiManagement.generated';
import { ApiType, ApiHistoryResponse } from '@/apollo/client/graphql/__types__';
import {
  buildRuntimeScopeUrl,
  omitRuntimeScopeQuery,
  readRuntimeScopeSelectorFromObject,
} from '@/apollo/client/runtimeScope';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
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

const PAGE_SIZE = 10;

const isAskShadowCompareApiType = (apiType?: ApiType) =>
  !apiType || apiType === ApiType.ASK || apiType === ApiType.STREAM_ASK;

export default function APIHistory() {
  const router = useRouter();
  const runtimeScopePage = useProtectedRuntimeScopePage();
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

  const shadowCompareFilter = useMemo(
    () => ({
      apiType: isAskShadowCompareApiType(selectedApiType)
        ? selectedApiType
        : undefined,
      statusCode: selectedStatusCode,
      threadId: selectedThreadId,
      ...dateFilter,
    }),
    [selectedApiType, selectedStatusCode, selectedThreadId, dateFilter],
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

  const { data, loading } = useApiHistoryQuery({
    fetchPolicy: 'cache-and-network',
    variables: {
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
    },
    skip: !runtimeScopePage.hasRuntimeScope || !router.isReady,
    onError: (error) => console.error(error),
  });

  const {
    data: shadowCompareData,
    loading: shadowCompareLoading,
    error: shadowCompareError,
  } = useAskShadowCompareStatsQuery({
    fetchPolicy: 'cache-and-network',
    variables: {
      filter: shadowCompareFilter,
    },
    skip:
      !router.isReady ||
      !runtimeScopePage.hasRuntimeScope ||
      !isAskShadowCompareApiType(selectedApiType),
    onError: (error) => console.error(error),
  });

  const columns: TableColumnsType<ApiHistoryResponse> = [
    {
      title: 'Timestamp',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (timestamp: string) => (
        <div className="gray-7">{getAbsoluteTime(timestamp)}</div>
      ),
    },
    {
      title: 'API type',
      dataIndex: 'apiType',
      key: 'apiType',
      width: 180,
      render: (type: ApiHistoryResponse['apiType']) => (
        <Tag className="gray-8">{type.toLowerCase()}</Tag>
      ),
      filters: Object.keys(ApiType).map((type) => ({
        text: type.toLowerCase(),
        value: type,
      })),
      filteredValue: filters['apiType'],
      filterMultiple: false,
    },
    {
      title: 'Status',
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
        { text: 'Successful (code: 2xx)', value: 200 },
        { text: 'Client error (code: 4xx)', value: 400 },
        { text: 'Server error (code: 5xx)', value: 500 },
      ],
      filteredValue: filters['statusCode'],
      filterMultiple: false,
    },
    {
      title: 'Question / SQL',
      dataIndex: 'requestPayload',
      key: 'requestPayload',
      render: (payload: Record<string, any>, record: ApiHistoryResponse) => {
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
      title: 'Thread ID',
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
        placeholder: 'thread ID',
        filteredValue: filters['threadId'],
      }),
    },
    {
      title: 'Diagnostics',
      dataIndex: 'responsePayload',
      key: 'diagnostics',
      width: 220,
      render: (responsePayload: Record<string, any>, record) => (
        <AskDiagnosticsSummary
          apiType={record.apiType}
          responsePayload={responsePayload}
        />
      ),
    },
    {
      title: 'Duration (ms)',
      dataIndex: 'durationMs',
      key: 'durationMs',
      width: 124,
      render: (durationMs: number) => (
        <div className="gray-7 text-right">{durationMs || '-'}</div>
      ),
    },
    {
      title: 'Actions',
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
          <EyeOutlined /> Details
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
      <SiderLayout loading sidebar={null}>
        {null}
      </SiderLayout>
    );
  }

  return (
    <SiderLayout loading={loading} sidebar={null}>
      <PageLayout
        title={
          <>
            <ApiOutlined className="mr-2 gray-8" />
            API history
          </>
        }
        description={
          <>
            <div>
              Here you can view the full history of API calls, including request
              inputs, responses, and execution details.{' '}
              <Link
                className="gray-8 underline mr-2"
                href="https://docs.getwren.ai/oss/guide/api-access/history"
                target="_blank"
                rel="noopener noreferrer"
              >
                Learn more.
              </Link>
            </div>
          </>
        }
        titleExtra={
          <Space size="middle">
            <Typography.Text className="gray-7">Time range</Typography.Text>
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
              Reset
            </Button>
          </Space>
        }
      >
        <ShadowCompareSummary
          stats={shadowCompareData?.askShadowCompareStats}
          loading={shadowCompareLoading}
          unsupportedApiType={
            isAskShadowCompareApiType(selectedApiType) ? null : selectedApiType
          }
        />
        {shadowCompareError && (
          <Alert
            className="mb-4"
            type="warning"
            showIcon
            message="Failed to load shadow compare rollout stats"
            description={shadowCompareError.message}
          />
        )}
        <Table
          className="ant-table-has-header"
          dataSource={data?.apiHistory.items || []}
          loading={loading || !router.isReady}
          columns={columns}
          rowKey="id"
          pagination={{
            current: currentPage,
            hideOnSinglePage: true,
            pageSize: PAGE_SIZE,
            size: 'small',
            total: data?.apiHistory.total,
          }}
          scroll={{ x: 1420 }}
          onChange={(pagination, nextFilters, _sorter) => {
            syncHistoryQuery({
              currentPage: pagination.current || 1,
              filters: normalizeApiHistoryTableFilters(nextFilters),
              dateRange,
            });
          }}
        />
        <DetailsDrawer
          {...detailsDrawer.state}
          onClose={detailsDrawer.closeDrawer}
        />
      </PageLayout>
    </SiderLayout>
  );
}
