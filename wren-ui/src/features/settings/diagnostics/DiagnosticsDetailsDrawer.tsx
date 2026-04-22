import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import CloseCircleOutlined from '@ant-design/icons/CloseCircleOutlined';
import {
  Descriptions,
  Drawer,
  Form,
  Input,
  Space,
  Tag,
  Typography,
} from 'antd';
import type { ApiHistoryResponse } from '@/types/apiHistory';
import { getAbsoluteTime } from '@/utils/time';
import { getAskDiagnostics } from '@/components/pages/apiManagement/askDiagnostics';
import { formatApiTypeLabel } from '@/components/pages/apiManagement/apiTypeLabels';

const { Paragraph, Text } = Typography;

type Props = {
  visible?: boolean;
  onClose: () => void;
  defaultValue?: ApiHistoryResponse;
};

const renderTextValue = (value?: string | number | null) => {
  if (value === null || value === undefined || value === '') {
    return <Text type="secondary">-</Text>;
  }

  return <Text>{value}</Text>;
};

const renderCopyableValue = (value?: string | null) => {
  if (!value) {
    return <Text type="secondary">-</Text>;
  }

  return (
    <Paragraph copyable={{ text: value }} style={{ marginBottom: 0 }}>
      {value}
    </Paragraph>
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
    <Tag color={active ? 'success' : 'default'}>
      {active ? activeLabel : inactiveLabel}
    </Tag>
  );
};

const getStatusTag = (status?: number | null) => {
  if (!status) {
    return renderTextValue(null);
  }

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

const toPrettyJson = (value?: Record<string, any> | null) => {
  if (!value) {
    return '';
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{}';
  }
};

export default function DiagnosticsDetailsDrawer({
  visible,
  onClose,
  defaultValue,
}: Props) {
  const askDiagnostics = getAskDiagnostics(defaultValue?.responsePayload);
  const shadowCompare = askDiagnostics?.shadowCompare;

  const requestSummaryItems = [
    {
      key: 'apiType',
      label: 'API 类型',
      children: defaultValue?.apiType ? (
        <Tag>{formatApiTypeLabel(defaultValue.apiType)}</Tag>
      ) : (
        <Text type="secondary">-</Text>
      ),
    },
    {
      key: 'threadId',
      label: '线程 ID',
      children: renderCopyableValue(defaultValue?.threadId),
    },
    {
      key: 'createdAt',
      label: '创建时间',
      children: renderTextValue(
        defaultValue?.createdAt
          ? getAbsoluteTime(defaultValue.createdAt)
          : null,
      ),
    },
    {
      key: 'durationMs',
      label: '耗时',
      children: renderTextValue(
        defaultValue?.durationMs === null ||
          defaultValue?.durationMs === undefined
          ? null
          : `${defaultValue.durationMs} ms`,
      ),
    },
    {
      key: 'statusCode',
      label: '状态码',
      children: getStatusTag(defaultValue?.statusCode),
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
            <Tag>{askDiagnostics.askPath}</Tag>
          ) : (
            <Text type="secondary">-</Text>
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
          key: 'executed',
          label: '影子链路执行',
          children: renderStateTag('已执行', shadowCompare.executed, {
            activeLabel: '已执行',
            inactiveLabel: '未执行',
          }),
        },
        {
          key: 'comparable',
          label: '是否可比',
          children: renderStateTag('可比', shadowCompare.comparable, {
            activeLabel: '可比',
            inactiveLabel: '不可比',
          }),
        },
        {
          key: 'matched',
          label: '比对结果',
          children: shadowCompare.comparable
            ? renderStateTag('已匹配', shadowCompare.matched, {
                activeLabel: '已匹配',
                inactiveLabel: '不匹配',
              })
            : renderTextValue(null),
        },
        {
          key: 'reason',
          label: '原因',
          children: renderTextValue(shadowCompare.reason),
        },
      ]
    : [];

  return (
    <Drawer
      open={visible}
      onClose={onClose}
      title="调用详情"
      size="large"
      destroyOnHidden
    >
      {!defaultValue ? null : (
        <Space orientation="vertical" size={24} style={{ width: '100%' }}>
          <Descriptions
            title="请求概览"
            bordered
            size="small"
            column={2}
            items={requestSummaryItems}
          />

          {askDiagnosticsItems.length ? (
            <Descriptions
              title="Ask 诊断"
              bordered
              size="small"
              column={2}
              items={askDiagnosticsItems}
            />
          ) : null}

          {shadowCompareItems.length ? (
            <Descriptions
              title="Shadow Compare"
              bordered
              size="small"
              column={2}
              items={shadowCompareItems}
            />
          ) : null}

          <Form layout="vertical">
            <Form.Item label="Request Payload" style={{ marginBottom: 0 }}>
              <Input.TextArea
                readOnly
                value={toPrettyJson(defaultValue.requestPayload)}
                autoSize={{ minRows: 8, maxRows: 16 }}
              />
            </Form.Item>
          </Form>

          <Form layout="vertical">
            <Form.Item label="Response Payload" style={{ marginBottom: 0 }}>
              <Input.TextArea
                readOnly
                value={toPrettyJson(defaultValue.responsePayload)}
                autoSize={{ minRows: 10, maxRows: 20 }}
              />
            </Form.Item>
          </Form>
        </Space>
      )}
    </Drawer>
  );
}
