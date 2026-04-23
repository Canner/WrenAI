import { useCallback, useState } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import type {
  AdjustThreadResponseChartInput,
  ThreadResponse,
} from '@/types/home';
import { ThreadResponseKind } from '@/types/home';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import {
  createThreadResponse as createThreadResponseRequest,
  adjustThreadResponseChart as adjustThreadResponseChartRequest,
  triggerThreadResponseAnswer as triggerThreadResponseAnswerRequest,
  triggerThreadResponseChart as triggerThreadResponseChartRequest,
  updateThreadResponseSql as updateThreadResponseSqlRequest,
} from '@/utils/threadRest';
import { findExistingChartFollowUpResponse } from './threadWorkbenchState';
import { resolveThreadResponseRuntimeSelector } from './threadResponseRuntime';

const reportThreadError = (_error: unknown, fallbackMessage: string) => {
  message.error(fallbackMessage);
};

type GenerateChartOptions = {
  question?: string;
  sourceResponseId?: number;
};

export function useThreadResponseMutationActions({
  currentResponses,
  currentThreadId,
  onSelectResponse,
  runtimeScopeSelector,
  startThreadResponsePolling,
  upsertThreadResponse,
}: {
  currentResponses: ThreadResponse[];
  currentThreadId?: number | null;
  onSelectResponse?: (
    responseId: number,
    options?: {
      artifact?: 'preview' | 'sql' | 'chart' | null;
      openWorkbench?: boolean;
      userInitiated?: boolean;
    },
  ) => void;
  runtimeScopeSelector: ClientRuntimeScopeSelector;
  startThreadResponsePolling: (responseId: number) => void;
  upsertThreadResponse: (nextResponse: ThreadResponse) => void;
}) {
  const [threadResponseUpdating, setThreadResponseUpdating] = useState(false);
  const resolveResponseRuntimeScopeSelector = useCallback(
    (response?: ThreadResponse | null) =>
      resolveThreadResponseRuntimeSelector({
        response,
        fallbackSelector: runtimeScopeSelector,
      }),
    [runtimeScopeSelector],
  );

  const onGenerateThreadResponseAnswer = useCallback(
    async (responseId: number) => {
      try {
        const currentResponse =
          currentResponses.find((response) => response.id === responseId) ||
          null;
        const nextResponse = await triggerThreadResponseAnswerRequest(
          resolveResponseRuntimeScopeSelector(currentResponse),
          responseId,
        );
        upsertThreadResponse(nextResponse);
        startThreadResponsePolling(responseId);
      } catch (error) {
        reportThreadError(error, '生成回答失败，请稍后重试');
      }
    },
    [
      currentResponses,
      resolveResponseRuntimeScopeSelector,
      startThreadResponsePolling,
      upsertThreadResponse,
    ],
  );

  const onGenerateThreadResponseChart = useCallback(
    async (responseId: number, options?: GenerateChartOptions) => {
      try {
        const currentResponse = currentResponses.find(
          (response) => response.id === responseId,
        );
        if (!currentResponse) {
          message.error('当前回答不存在，请刷新后重试');
          return;
        }

        const shouldReuseCurrentResponse =
          currentResponse.responseKind === ThreadResponseKind.CHART_FOLLOWUP;

        let targetResponse = currentResponse;
        if (!shouldReuseCurrentResponse) {
          if (!currentThreadId) {
            message.error('当前对话尚未就绪，请稍后再试');
            return;
          }

          const sourceResponseId = options?.sourceResponseId ?? responseId;
          const existingChartResponse = findExistingChartFollowUpResponse({
            responses: currentResponses,
            sourceResponseId,
          });
          if (existingChartResponse) {
            targetResponse = existingChartResponse;
          } else {
            targetResponse = await createThreadResponseRequest(
              resolveResponseRuntimeScopeSelector(currentResponse),
              currentThreadId,
              {
                question: options?.question || '生成图表',
                responseKind: ThreadResponseKind.CHART_FOLLOWUP,
                sourceResponseId,
              },
            );
            upsertThreadResponse(targetResponse);
          }
        }

        onSelectResponse?.(targetResponse.id, {
          artifact: 'chart',
          openWorkbench: false,
        });

        const nextResponse = await triggerThreadResponseChartRequest(
          resolveResponseRuntimeScopeSelector(targetResponse),
          targetResponse.id,
        );
        upsertThreadResponse(nextResponse);
        startThreadResponsePolling(nextResponse.id);
      } catch (error) {
        reportThreadError(error, '生成图表失败，请稍后重试');
      }
    },
    [
      currentResponses,
      currentThreadId,
      onSelectResponse,
      resolveResponseRuntimeScopeSelector,
      startThreadResponsePolling,
      upsertThreadResponse,
    ],
  );

  const onAdjustThreadResponseChart = useCallback(
    async (responseId: number, data: AdjustThreadResponseChartInput) => {
      try {
        const currentResponse =
          currentResponses.find((response) => response.id === responseId) ||
          null;
        const nextResponse = await adjustThreadResponseChartRequest(
          resolveResponseRuntimeScopeSelector(currentResponse),
          responseId,
          data,
        );
        upsertThreadResponse(nextResponse);
      } catch (error) {
        reportThreadError(error, '调整图表失败，请稍后重试');
      }
    },
    [
      currentResponses,
      resolveResponseRuntimeScopeSelector,
      upsertThreadResponse,
    ],
  );

  const onFixSQLStatement = useCallback(
    async (responseId: number, sql: string) => {
      setThreadResponseUpdating(true);
      try {
        const currentResponse =
          currentResponses.find((response) => response.id === responseId) ||
          null;
        const nextResponse = await updateThreadResponseSqlRequest(
          resolveResponseRuntimeScopeSelector(currentResponse),
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
      currentResponses,
      onGenerateThreadResponseAnswer,
      resolveResponseRuntimeScopeSelector,
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
