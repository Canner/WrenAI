import { Drawer, Typography, Row, Col, Tag } from 'antd';
import { getAbsoluteTime } from '@/utils/time';
import { DrawerAction } from '@/hooks/useDrawerAction';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import CloseCircleOutlined from '@ant-design/icons/CloseCircleOutlined';
import JsonCodeBlock from '@/components/code/JsonCodeBlock';
import { ApiHistoryResponse } from '@/apollo/client/graphql/__types__';
import { getAskDiagnostics } from './askDiagnostics';

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
  const inactiveLabel = options?.inactiveLabel || `not ${label}`;

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
      title="API details"
      width={760}
      closable
      destroyOnClose
      onClose={onClose}
      footer={null}
    >
      <Row className="mb-6">
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            API type
          </Typography.Text>
          <div>
            <Tag className="gray-8">{apiType?.toLowerCase()}</Tag>
          </div>
        </Col>
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            Thread ID
          </Typography.Text>
          <div>{threadId || '-'}</div>
        </Col>
      </Row>
      <Row className="mb-6">
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            Created at
          </Typography.Text>
          <div>{getAbsoluteTime(createdAt)}</div>
        </Col>
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            Duration
          </Typography.Text>
          <div>{durationMs} ms</div>
        </Col>
      </Row>
      <Row className="mb-6">
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            Status code
          </Typography.Text>
          <div>{getStatusTag(statusCode)}</div>
        </Col>
      </Row>

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Headers
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
          Request payload
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
            Ask diagnostics
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
                Ask path
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
                  Shadow compare
                </Typography.Text>
                <div>
                  {renderStateTag('enabled', shadowCompare.enabled)}
                  {renderStateTag('executed', shadowCompare.executed)}
                  {renderStateTag('comparable', shadowCompare.comparable)}
                  {shadowCompare.comparable !== undefined &&
                    renderStateTag('matched', shadowCompare.matched, {
                      activeLabel: 'matched',
                      inactiveLabel: 'mismatched',
                    })}
                </div>
              </div>

              <Row className="mb-4">
                <Col span={12}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    Primary path
                  </Typography.Text>
                  {renderTextValue(shadowCompare.primaryAskPath)}
                </Col>
                <Col span={12}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    Shadow path
                  </Typography.Text>
                  {renderTextValue(shadowCompare.shadowAskPath)}
                </Col>
              </Row>

              <Row className="mb-4">
                <Col span={12}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    Primary type
                  </Typography.Text>
                  {renderTextValue(shadowCompare.primaryType)}
                </Col>
                <Col span={12}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    Shadow type
                  </Typography.Text>
                  {renderTextValue(shadowCompare.shadowType)}
                </Col>
              </Row>

              <Row className="mb-4">
                <Col span={12}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    Primary result count
                  </Typography.Text>
                  {renderTextValue(shadowCompare.primaryResultCount)}
                </Col>
                <Col span={12}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    Shadow result count
                  </Typography.Text>
                  {renderTextValue(shadowCompare.shadowResultCount)}
                </Col>
              </Row>

              <Row className="mb-4">
                <Col span={12}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    Primary error type
                  </Typography.Text>
                  {renderTextValue(shadowCompare.primaryErrorType)}
                </Col>
                <Col span={12}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    Shadow error type
                  </Typography.Text>
                  {renderTextValue(shadowCompare.shadowErrorType)}
                </Col>
              </Row>

              <Row className="mb-4">
                <Col span={24}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    Reason
                  </Typography.Text>
                  {renderTextValue(shadowCompare.reason)}
                </Col>
              </Row>

              <Row className="mb-4">
                <Col span={24}>
                  <Typography.Text className="d-block gray-7 mb-2">
                    Shadow error
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
          Response payload
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
