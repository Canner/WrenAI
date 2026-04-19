import { useCallback, useState } from 'react';
import { message } from 'antd';
import type {
  AdjustThreadResponseChartInput,
  ThreadResponse,
} from '@/types/home';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import {
  adjustThreadResponseChart as adjustThreadResponseChartRequest,
  triggerThreadResponseAnswer as triggerThreadResponseAnswerRequest,
  triggerThreadResponseChart as triggerThreadResponseChartRequest,
  updateThreadResponseSql as updateThreadResponseSqlRequest,
} from '@/utils/threadRest';

const reportThreadError = (_error: unknown, fallbackMessage: string) => {
  message.error(fallbackMessage);
};

export function useThreadResponseMutationActions({
  runtimeScopeSelector,
  startThreadResponsePolling,
  upsertThreadResponse,
}: {
  runtimeScopeSelector: ClientRuntimeScopeSelector;
  startThreadResponsePolling: (responseId: number) => void;
  upsertThreadResponse: (nextResponse: ThreadResponse) => void;
}) {
  const [threadResponseUpdating, setThreadResponseUpdating] = useState(false);

  const onGenerateThreadResponseAnswer = useCallback(
    async (responseId: number) => {
      try {
        const nextResponse = await triggerThreadResponseAnswerRequest(
          runtimeScopeSelector,
          responseId,
        );
        upsertThreadResponse(nextResponse);
        startThreadResponsePolling(responseId);
      } catch (error) {
        reportThreadError(error, '生成回答失败，请稍后重试');
      }
    },
    [runtimeScopeSelector, startThreadResponsePolling, upsertThreadResponse],
  );

  const onGenerateThreadResponseChart = useCallback(
    async (responseId: number) => {
      try {
        const nextResponse = await triggerThreadResponseChartRequest(
          runtimeScopeSelector,
          responseId,
        );
        upsertThreadResponse(nextResponse);
        startThreadResponsePolling(responseId);
      } catch (error) {
        reportThreadError(error, '生成图表失败，请稍后重试');
      }
    },
    [runtimeScopeSelector, startThreadResponsePolling, upsertThreadResponse],
  );

  const onAdjustThreadResponseChart = useCallback(
    async (responseId: number, data: AdjustThreadResponseChartInput) => {
      try {
        const nextResponse = await adjustThreadResponseChartRequest(
          runtimeScopeSelector,
          responseId,
          data,
        );
        upsertThreadResponse(nextResponse);
      } catch (error) {
        reportThreadError(error, '调整图表失败，请稍后重试');
      }
    },
    [runtimeScopeSelector, upsertThreadResponse],
  );

  const onFixSQLStatement = useCallback(
    async (responseId: number, sql: string) => {
      setThreadResponseUpdating(true);
      try {
        const nextResponse = await updateThreadResponseSqlRequest(
          runtimeScopeSelector,
          responseId,
          { sql },
        );
        upsertThreadResponse(nextResponse);
        message.success('SQL 语句已更新。');
        await onGenerateThreadResponseAnswer(nextResponse.id);
      } catch (error) {
        reportThreadError(error, '更新 SQL 失败，请稍后重试');
      } finally {
        setThreadResponseUpdating(false);
      }
    },
    [
      onGenerateThreadResponseAnswer,
      runtimeScopeSelector,
      upsertThreadResponse,
    ],
  );

  return {
    onAdjustThreadResponseChart,
    onFixSQLStatement,
    onGenerateThreadResponseAnswer,
    onGenerateThreadResponseChart,
    threadResponseUpdating,
  };
}
