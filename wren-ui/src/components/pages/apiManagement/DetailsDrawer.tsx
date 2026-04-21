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
        labelStyle={{ width: 108, color: 'var(--nova-text-secondary)' }}
      >
        <Descriptions.Item label="API 类型">
          <Tag className="gray-8">{formatApiTypeLabel(apiType)}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="线程 ID">
          {renderTextValue(threadId)}
        </Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {renderTextValue(createdAt ? getAbsoluteTime(createdAt) : null)}
        </Descriptions.Item>
        <Descriptions.Item label="耗时">
          {renderTextValue(
            durationMs === null || durationMs === undefined
              ? null
              : `${durationMs} ms`,
          )}
        </Descriptions.Item>
        <Descriptions.Item label="状态码">
          {statusCode ? getStatusTag(statusCode) : renderTextValue(null)}
        </Descriptions.Item>
      </Descriptions>

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
            labelStyle={{ width: 108, color: 'var(--nova-text-secondary)' }}
          >
            <Descriptions.Item label="Trace ID">
              {renderCopyableValue(askDiagnostics.traceId)}
            </Descriptions.Item>
            <Descriptions.Item label="问答路径">
              {askDiagnostics.askPath ? (
                <Tag className="gray-8">{askDiagnostics.askPath}</Tag>
              ) : (
                <Typography.Text type="secondary">-</Typography.Text>
              )}
            </Descriptions.Item>
          </Descriptions>

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
                labelStyle={{ width: 132, color: 'var(--nova-text-secondary)' }}
              >
                <Descriptions.Item label="主链路路径">
                  {renderTextValue(shadowCompare.primaryAskPath)}
                </Descriptions.Item>
                <Descriptions.Item label="影子链路路径">
                  {renderTextValue(shadowCompare.shadowAskPath)}
                </Descriptions.Item>
                <Descriptions.Item label="主链路类型">
                  {renderTextValue(shadowCompare.primaryType)}
                </Descriptions.Item>
                <Descriptions.Item label="影子链路类型">
                  {renderTextValue(shadowCompare.shadowType)}
                </Descriptions.Item>
                <Descriptions.Item label="主链路结果数">
                  {renderTextValue(shadowCompare.primaryResultCount)}
                </Descriptions.Item>
                <Descriptions.Item label="影子链路结果数">
                  {renderTextValue(shadowCompare.shadowResultCount)}
                </Descriptions.Item>
                <Descriptions.Item label="主链路错误类型">
                  {renderTextValue(shadowCompare.primaryErrorType)}
                </Descriptions.Item>
                <Descriptions.Item label="影子链路错误类型">
                  {renderTextValue(shadowCompare.shadowErrorType)}
                </Descriptions.Item>
                <Descriptions.Item label="原因" span={2}>
                  {renderTextValue(shadowCompare.reason)}
                </Descriptions.Item>
                <Descriptions.Item label="影子链路错误详情" span={2}>
                  {renderTextValue(shadowCompare.shadowError)}
                </Descriptions.Item>
              </Descriptions>
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
