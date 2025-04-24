import Link from 'next/link';
import { Table, TableColumnsType, Button, Tag, Typography } from 'antd';
import { getAbsoluteTime } from '@/utils/time';
import useDrawerAction from '@/hooks/useDrawerAction';
import SiderLayout from '@/components/layouts/SiderLayout';
import PageLayout from '@/components/layouts/PageLayout';
import ApiOutlined from '@ant-design/icons/ApiOutlined';
import ReadOutlined from '@ant-design/icons/ReadOutlined';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import EyeOutlined from '@ant-design/icons/EyeOutlined';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import CloseCircleOutlined from '@ant-design/icons/CloseCircleOutlined';
import SQLCodeBlock from '@/components/code/SQLCodeBlock';
import DetailsDrawer from '@/components/pages/apiHistory/DetailsDrawer';
import { useApiHistoryQuery } from '@/apollo/client/graphql/apiHistory.generated';
import { ApiType, ApiHistoryResponse } from '@/apollo/client/graphql/__types__';

export default function APIHistory() {
  const detailsDrawer = useDrawerAction();

  const { data, loading } = useApiHistoryQuery({
    fetchPolicy: 'cache-and-network',
    variables: {
      pagination: {
        offset: 0,
        limit: 10,
      },
    },
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
      width: 130,
      render: (type: ApiHistoryResponse['apiType']) => (
        <Tag className="gray-8">{type.toLowerCase()}</Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'statusCode',
      key: 'statusCode',
      width: 80,
      render: (status: number) => {
        const icon =
          status === 200 ? <CheckCircleOutlined /> : <CloseCircleOutlined />;
        const color = status === 200 ? 'success' : 'error';
        return (
          <Tag icon={icon} color={color}>
            {status}
          </Tag>
        );
      },
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
          <div className="gray-8">{payload.question || payload.sql || '-'}</div>
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

  return (
    <SiderLayout loading={false} sidebar={null}>
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
              inputs, responses, and execution details.
            </div>
            <div className="d-flex align-center mt-3">
              <ReadOutlined className="mr-2 gray-8" />
              <Link
                className="gray-8 underline mr-2"
                href="https://docs.getwren.ai/oss/guide/api-history"
              >
                API reference
              </Link>
              Learn how to use each API
            </div>
            <div className="d-flex align-center mt-1">
              <InfoCircleOutlined className="mr-2 gray-8" />
              <Link
                className="gray-8 underline mr-2"
                href="https://docs.getwren.ai/oss/guide/api-history"
              >
                Page guide
              </Link>
              Understand how to read and use this history log
            </div>
          </>
        }
      >
        <Table
          className="ant-table-has-header"
          dataSource={data?.apiHistory.items || []}
          loading={loading}
          columns={columns}
          rowKey="id"
          pagination={{
            hideOnSinglePage: true,
            pageSize: 10,
            size: 'small',
          }}
          scroll={{ x: 1080 }}
        />
        <DetailsDrawer
          {...detailsDrawer.state}
          onClose={detailsDrawer.closeDrawer}
        />
      </PageLayout>
    </SiderLayout>
  );
}
