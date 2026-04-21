import { Descriptions, Divider, Drawer, Space, Tag, Typography } from 'antd';
import { getAbsoluteTime } from '@/utils/time';
import type { DrawerAction } from '@/hooks/useDrawerAction';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import CloseCircleOutlined from '@ant-design/icons/CloseCircleOutlined';
import JsonCodeBlock from '@/components/code/JsonCodeBlock';
import type { ApiHistoryResponse } from '@/types/apiHistory';

import { getAskDiagnostics } from './askDiagnostics';
import { formatApiTypeLabel } from './apiTypeLabels';

type Props = DrawerAction<ApiHistoryResponse> & {
  loading?: boolean;
};

const renderTextValue = (value?: string | number | null) => {
  if (value === null || value === undefined || value === '') {
    return <Typography.Text type="secondary">-</Typography.Text>;
  }

  return <span>{value}</span>;
};

const renderCopyableValue = (value?: string | null) => {
  if (!value) {
    return <Typography.Text type="secondary">-</Typography.Text>;
  }

  return (
    <Typography.Text ellipsis copyable={{ text: value }}>
      {value}
    </Typography.Text>
  );
};

const renderStateTag = (
  label: string,
  active?: boolean,
  options?: {
    activeLabel?: string;
    inactiveLabel?: string;
  },
) => {
  const activeLabel = options?.activeLabel || label;
  const inactiveLabel = options?.inactiveLabel || `未${label}`;

  return (
    <Tag color={active ? 'success' : 'default'} className="mr-2 mb-2">
      {active ? activeLabel : inactiveLabel}
    </Tag>
  );
};

export default function DetailsDrawer(props: Props) {
  const { visible, onClose, defaultValue } = props;

  const {
    threadId,
    apiType,
    createdAt,
    durationMs,
    statusCode,
    headers,
    requestPayload,
    responsePayload,
  } = defaultValue || {};
  const askDiagnostics = getAskDiagnostics(responsePayload);
  const shadowCompare = askDiagnostics?.shadowCompare;

  const getStatusTag = (status: number) => {
    const isSuccess = status >= 200 && status < 300;
    return (
      <Tag
        icon={isSuccess ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
        color={isSuccess ? 'success' : 'error'}
      >
        {status}
      </Tag>
    );
  };
  const requestSummaryItems = [
    {
      key: 'apiType',
      label: 'API 类型',
      children: <Tag className="gray-8">{formatApiTypeLabel(apiType)}</Tag>,
    },
    {
      key: 'threadId',
      label: '线程 ID',
      children: renderTextValue(threadId),
    },
    {
      key: 'createdAt',
      label: '创建时间',
      children: renderTextValue(createdAt ? getAbsoluteTime(createdAt) : null),
    },
    {
      key: 'durationMs',
      label: '耗时',
      children: renderTextValue(
        durationMs === null || durationMs === undefined
          ? null
          : `${durationMs} ms`,
      ),
    },
    {
      key: 'statusCode',
      label: '状态码',
      children: statusCode ? getStatusTag(statusCode) : renderTextValue(null),
    },
  ];
  const askDiagnosticsItems = askDiagnostics
    ? [
        {
          key: 'traceId',
          label: 'Trace ID',
          children: renderCopyableValue(askDiagnostics.traceId),
        },
        {
          key: 'askPath',
          label: '问答路径',
          children: askDiagnostics.askPath ? (
            <Tag className="gray-8">{askDiagnostics.askPath}</Tag>
          ) : (
            <Typography.Text type="secondary">-</Typography.Text>
          ),
        },
      ]
    : [];
  const shadowCompareItems = shadowCompare
    ? [
        {
          key: 'primaryAskPath',
          label: '主链路路径',
          children: renderTextValue(shadowCompare.primaryAskPath),
        },
        {
          key: 'shadowAskPath',
          label: '影子链路路径',
          children: renderTextValue(shadowCompare.shadowAskPath),
        },
        {
          key: 'primaryType',
          label: '主链路类型',
          children: renderTextValue(shadowCompare.primaryType),
        },
        {
          key: 'shadowType',
          label: '影子链路类型',
          children: renderTextValue(shadowCompare.shadowType),
        },
        {
          key: 'primaryResultCount',
          label: '主链路结果数',
          children: renderTextValue(shadowCompare.primaryResultCount),
        },
        {
          key: 'shadowResultCount',
          label: '影子链路结果数',
          children: renderTextValue(shadowCompare.shadowResultCount),
        },
        {
          key: 'primaryErrorType',
          label: '主链路错误类型',
          children: renderTextValue(shadowCompare.primaryErrorType),
        },
        {
          key: 'shadowErrorType',
          label: '影子链路错误类型',
          children: renderTextValue(shadowCompare.shadowErrorType),
        },
        {
          key: 'reason',
          label: '原因',
          span: 2,
          children: renderTextValue(shadowCompare.reason),
        },
        {
          key: 'shadowError',
          label: '影子链路错误详情',
          span: 2,
          children: renderTextValue(shadowCompare.shadowError),
        },
      ]
    : [];

  return (
    <Drawer
      open={visible}
      className="gray-8"
      title="API 调用详情"
      size={760}
      closable
      destroyOnHidden
      onClose={onClose}
      footer={null}
    >
      <Descriptions
        bordered
        column={2}
        size="small"
        items={requestSummaryItems}
        styles={{
          label: { width: 108, color: 'var(--nova-text-secondary)' },
        }}
      />

      <Divider titlePlacement="start" plain>
        请求头
      </Divider>
      <JsonCodeBlock
        code={headers}
        backgroundColor="var(--gray-2)"
        maxHeight="400"
        copyable
      />

      <Divider titlePlacement="start" plain>
        请求载荷
      </Divider>
      <JsonCodeBlock
        code={requestPayload}
        backgroundColor="var(--gray-2)"
        maxHeight="400"
        copyable
      />

      {askDiagnostics ? (
        <>
          <Divider titlePlacement="start" plain>
            问答诊断
          </Divider>
          <Descriptions
            bordered
            column={2}
            size="small"
            items={askDiagnosticsItems}
            styles={{
              label: { width: 108, color: 'var(--nova-text-secondary)' },
            }}
          />

          {shadowCompare ? (
            <>
              <Divider titlePlacement="start" plain>
                影子对比
              </Divider>
              <Space wrap size={[8, 8]} style={{ marginBottom: 16 }}>
                {renderStateTag('启用', shadowCompare.enabled)}
                {renderStateTag('执行', shadowCompare.executed)}
                {renderStateTag('可比对', shadowCompare.comparable, {
                  inactiveLabel: '不可比对',
                })}
                {shadowCompare.comparable !== undefined
                  ? renderStateTag('匹配', shadowCompare.matched, {
                      activeLabel: '已匹配',
                      inactiveLabel: '不匹配',
                    })
                  : null}
              </Space>
              <Descriptions
                bordered
                column={2}
                size="small"
                items={shadowCompareItems}
                styles={{
                  label: { width: 132, color: 'var(--nova-text-secondary)' },
                }}
              />
            </>
          ) : null}
        </>
      ) : null}

      <Divider titlePlacement="start" plain>
        响应载荷
      </Divider>
      <JsonCodeBlock
        code={responsePayload}
        backgroundColor="var(--gray-2)"
        maxHeight="400"
        copyable
      />
    </Drawer>
  );
}
