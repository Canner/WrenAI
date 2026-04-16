import { Drawer, Typography, Row, Col, Tag } from 'antd';
import { getAbsoluteTime } from '@/utils/time';
import { DrawerAction } from '@/hooks/useDrawerAction';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import CloseCircleOutlined from '@ant-design/icons/CloseCircleOutlined';
import JsonCodeBlock from '@/components/code/JsonCodeBlock';
import { ApiHistoryResponse } from '@/types/api';
import { getAskDiagnostics } from './askDiagnostics';
import { formatApiTypeLabel } from './apiTypeLabels';

type Props = DrawerAction<ApiHistoryResponse> & {
  loading?: boolean;
};

const renderTextValue = (value?: string | number | null) => {
  if (value === null || value === undefined || value === '') {
    return <div className="gray-7">-</div>;
  }

  return <div>{value}</div>;
};

const renderCopyableValue = (value?: string | null) => {
  if (!value) {
    return <div className="gray-7">-</div>;
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
      visible={visible}
      className="gray-8"
      title="API 调用详情"
      width={760}
      closable
      destroyOnClose
      onClose={onClose}
      footer={null}
    >
      <Row className="mb-6">
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            API 类型
          </Typography.Text>
          <div>
            <Tag className="gray-8">{formatApiTypeLabel(apiType)}</Tag>
          </div>
        </Col>
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            线程 ID
          </Typography.Text>
          <div>{threadId || '-'}</div>
        </Col>
      </Row>
      <Row className="mb-6">
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            创建时间
          </Typography.Text>
          <div>{createdAt ? getAbsoluteTime(createdAt) : '-'}</div>
        </Col>
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            耗时
          </Typography.Text>
          <div>{durationMs} ms</div>
        </Col>
      </Row>
      <Row className="mb-6">
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            状态码
          </Typography.Text>
          <div>{statusCode ? getStatusTag(statusCode) : '-'}</div>
        </Col>
      </Row>

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          请求头
        </Typography.Text>
        <JsonCodeBlock
          code={headers}
          backgroundColor="var(--gray-2)"
          maxHeight="400"
          copyable
        />
      </div>

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          请求载荷
        </Typography.Text>
        <JsonCodeBlock
          code={requestPayload}
          backgroundColor="var(--gray-2)"
          maxHeight="400"
          copyable
        />
      </div>

      {askDiagnostics && (
        <div className="mb-6">
          <Typography.Text className="d-block gray-7 mb-2">
            问答诊断
          </Typography.Text>
          <Row className="mb-4">
            <Col span={12}>
              <Typography.Text className="d-block gray-7 mb-2">
                Trace ID
              </Typography.Text>
              {renderCopyableValue(askDiagnostics.traceId)}
            </Col>
            <Col span={12}>
              <Typography.Text className="d-block gray-7 mb-2">
                问答路径
              </Typography.Text>
              {askDiagnostics.askPath ? (
                <Tag className="gray-8">{askDiagnostics.askPath}</Tag>
              ) : (
                <div className="gray-7">-</div>
              )}
            </Col>
          </Row>

          {shadowCompare && (
            <>
              <div className="mb-4">
                <Typography.Text className="d-block gray-7 mb-2">
                  影子对比
                </Typography.Text>
                <div>
                  {renderStateTag('启用', shadowCompare.enabled)}
                  {renderStateTag('执行', shadowCompare.executed)}
                  {renderStateTag('可比对', shadowCompare.comparable, {
                    inactiveLabel: '不可比对',
                  })}
                  {shadowCompare.comparable !== undefined &&
                    renderStateTag('匹配', shadowCompare.matched, {
                      activeLabel: '已匹配',
                      inactiveLabel: '不匹配',
                    })}
                </div>
              </div>

              <Row className="mb-4">
                <Col span={12}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    主链路路径
                  </Typography.Text>
                  {renderTextValue(shadowCompare.primaryAskPath)}
                </Col>
                <Col span={12}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    影子链路路径
                  </Typography.Text>
                  {renderTextValue(shadowCompare.shadowAskPath)}
                </Col>
              </Row>

              <Row className="mb-4">
                <Col span={12}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    主链路类型
                  </Typography.Text>
                  {renderTextValue(shadowCompare.primaryType)}
                </Col>
                <Col span={12}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    影子链路类型
                  </Typography.Text>
                  {renderTextValue(shadowCompare.shadowType)}
                </Col>
              </Row>

              <Row className="mb-4">
                <Col span={12}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    主链路结果数
                  </Typography.Text>
                  {renderTextValue(shadowCompare.primaryResultCount)}
                </Col>
                <Col span={12}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    影子链路结果数
                  </Typography.Text>
                  {renderTextValue(shadowCompare.shadowResultCount)}
                </Col>
              </Row>

              <Row className="mb-4">
                <Col span={12}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    主链路错误类型
                  </Typography.Text>
                  {renderTextValue(shadowCompare.primaryErrorType)}
                </Col>
                <Col span={12}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    影子链路错误类型
                  </Typography.Text>
                  {renderTextValue(shadowCompare.shadowErrorType)}
                </Col>
              </Row>

              <Row className="mb-4">
                <Col span={24}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    原因
                  </Typography.Text>
                  {renderTextValue(shadowCompare.reason)}
                </Col>
              </Row>

              <Row className="mb-4">
                <Col span={24}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    影子链路错误详情
                  </Typography.Text>
                  {renderTextValue(shadowCompare.shadowError)}
                </Col>
              </Row>
            </>
          )}
        </div>
      )}

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          响应载荷
        </Typography.Text>
        <JsonCodeBlock
          code={responsePayload}
          backgroundColor="var(--gray-2)"
          maxHeight="400"
          copyable
        />
      </div>
    </Drawer>
  );
}
