import { Tag, Tooltip } from 'antd';
import { ApiType } from '@/types/api';
import {
  getAskDiagnostics,
  isAskApiHistoryType,
} from '@/components/pages/apiManagement/askDiagnostics';

type Props = {
  apiType?: ApiType | null;
  responsePayload?: Record<string, any> | null;
};

const EMPTY_VIEW = <div className="gray-7">-</div>;
const REASON_PREVIEW_MAX_LENGTH = 48;

const toReasonPreview = (reason: string) => {
  if (reason.length <= REASON_PREVIEW_MAX_LENGTH) {
    return reason;
  }

  return `${reason.slice(0, REASON_PREVIEW_MAX_LENGTH - 1)}…`;
};

export default function AskDiagnosticsSummary(props: Props) {
  const { apiType, responsePayload } = props;

  if (!isAskApiHistoryType(apiType)) {
    return EMPTY_VIEW;
  }

  const askDiagnostics = getAskDiagnostics(responsePayload);
  if (!askDiagnostics) {
    return EMPTY_VIEW;
  }

  const shadowCompare = askDiagnostics.shadowCompare;
  const hasSummary =
    Boolean(askDiagnostics.askPath) ||
    Boolean(shadowCompare?.shadowErrorType) ||
    Boolean(shadowCompare?.reason) ||
    shadowCompare?.comparable !== undefined ||
    shadowCompare?.executed !== undefined;

  if (!hasSummary) {
    return EMPTY_VIEW;
  }

  return (
    <div>
      <div>
        {askDiagnostics.askPath && (
          <Tag className="mr-2 mb-2 gray-8">{askDiagnostics.askPath}</Tag>
        )}
        {shadowCompare?.comparable !== undefined ? (
          <Tag
            color={shadowCompare.matched ? 'success' : 'warning'}
            className="mr-2 mb-2"
          >
            {shadowCompare.matched ? '已匹配' : '不匹配'}
          </Tag>
        ) : shadowCompare?.executed ? (
          <Tag className="mr-2 mb-2">已执行</Tag>
        ) : null}
        {shadowCompare?.shadowErrorType && (
          <Tag color="error" className="mr-2 mb-2">
            {shadowCompare.shadowErrorType}
          </Tag>
        )}
      </div>
      {shadowCompare?.reason && (
        <Tooltip title={shadowCompare.reason}>
          <div className="gray-7">{toReasonPreview(shadowCompare.reason)}</div>
        </Tooltip>
      )}
    </div>
  );
}
