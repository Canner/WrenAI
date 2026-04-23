import { isEmpty } from 'lodash';

import type { ThreadResponse } from '@/types/home';
import {
  AskingTaskStatus,
  ChartTaskStatus,
  ThreadResponseAnswerStatus,
  ThreadResponseKind,
} from '@/types/home';

const hasConversationAidCandidates = (response?: ThreadResponse | null) =>
  Boolean(response?.resolvedIntent?.conversationAidPlan?.responseAids?.length);

export const hasSettledConversationAids = (
  response?: ThreadResponse | null,
) => {
  if (
    !response ||
    response.responseKind === ThreadResponseKind.RECOMMENDATION_FOLLOWUP
  ) {
    return false;
  }

  if (response.responseKind === ThreadResponseKind.CHART_FOLLOWUP) {
    return (
      response.chartDetail?.status === ChartTaskStatus.FINISHED ||
      response.chartDetail?.status === ChartTaskStatus.FAILED
    );
  }

  const answerStatus = response.answerDetail?.status;
  const isAnswerPrepared = Boolean(
    answerStatus &&
    ![
      ThreadResponseAnswerStatus.NOT_STARTED,
      ThreadResponseAnswerStatus.PREPROCESSING,
      ThreadResponseAnswerStatus.FETCHING_DATA,
      ThreadResponseAnswerStatus.STREAMING,
    ].includes(answerStatus),
  );
  const isBreakdownOnly =
    response.answerDetail === null && !isEmpty(response.breakdownDetail);
  const sqlText = typeof response.sql === 'string' ? response.sql.trim() : '';

  return Boolean(
    response.askingTask?.status === AskingTaskStatus.FINISHED ||
    isAnswerPrepared ||
    isBreakdownOnly ||
    sqlText,
  );
};

export const resolveConversationAidOwnerResponseId = ({
  responses,
}: {
  responses: ThreadResponse[];
  selectedResponseId?: number | null;
}) => {
  const latestEligibleResponse =
    [...(responses || [])]
      .reverse()
      .find(
        (response) =>
          hasConversationAidCandidates(response) &&
          hasSettledConversationAids(response),
      ) || null;

  return latestEligibleResponse?.id ?? null;
};
