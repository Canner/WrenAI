import { Space, Tag, Tooltip, Typography } from 'antd';
import { ApiType } from '@/types/apiHistory';
import {
  getAskDiagnostics,
  isAskApiHistoryType,
} from '@/components/pages/apiManagement/askDiagnostics';

const { Text } = Typography;

type Props = {
  apiType?: ApiType | null;
  responsePayload?: Record<string, any> | null;
};

const REASON_PREVIEW_MAX_LENGTH = 48;

const toReasonPreview = (reason: string) =>
  reason.length <= REASON_PREVIEW_MAX_LENGTH
    ? reason
    : `${reason.slice(0, REASON_PREVIEW_MAX_LENGTH - 1)}…`;

export default function DiagnosticsSummaryCell({
  apiType,
  responsePayload,
}: Props) {
  if (!isAskApiHistoryType(apiType)) {
    return <Text type="secondary">-</Text>;
  }

  const askDiagnostics = getAskDiagnostics(responsePayload);
  if (!askDiagnostics) {
    return <Text type="secondary">-</Text>;
  }

  const shadowCompare = askDiagnostics.shadowCompare;
  const hasSummary =
    Boolean(askDiagnostics.askPath) ||
    Boolean(shadowCompare?.shadowErrorType) ||
    Boolean(shadowCompare?.reason) ||
    shadowCompare?.comparable !== undefined ||
    shadowCompare?.executed !== undefined;

  if (!hasSummary) {
    return <Text type="secondary">-</Text>;
  }

  return (
    <Space orientation="vertical" size={shadowCompare?.reason ? 8 : 0}>
      <Space size={[4, 4]} wrap>
        {askDiagnostics.askPath ? (
          <Tag color="default">{askDiagnostics.askPath}</Tag>
        ) : null}
        {shadowCompare?.comparable !== undefined ? (
          <Tag color={shadowCompare.matched ? 'success' : 'warning'}>
            {shadowCompare.matched ? '已匹配' : '不匹配'}
          </Tag>
        ) : shadowCompare?.executed ? (
          <Tag color="processing">已执行</Tag>
        ) : null}
        {shadowCompare?.shadowErrorType ? (
          <Tag color="error">{shadowCompare.shadowErrorType}</Tag>
        ) : null}
      </Space>

      {shadowCompare?.reason ? (
        <Tooltip title={shadowCompare.reason}>
          <Text type="secondary">{toReasonPreview(shadowCompare.reason)}</Text>
        </Tooltip>
      ) : null}
    </Space>
  );
}
