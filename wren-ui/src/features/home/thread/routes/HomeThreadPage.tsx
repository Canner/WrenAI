import { CreateSqlPairInput } from '@/types/knowledge';
import { useRouter } from 'next/router';
import { ComponentRef, useCallback, useMemo, useRef, useState } from 'react';
import type { ThreadResponse } from '@/types/home';
import { message } from 'antd';
import { Path } from '@/utils/enum';
import Prompt from '@/components/pages/home/prompt';
import useAskPrompt from '@/hooks/useAskPrompt';
import useAdjustAnswer from '@/hooks/useAdjustAnswer';
import useModalAction from '@/hooks/useModalAction';
import {
  IPromptThreadStore,
  PromptThreadProvider,
} from '@/components/pages/home/promptThread/store';
import ThreadPageShell from '@/features/home/thread/components/ThreadPageShell';

import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import {
  HISTORICAL_SNAPSHOT_READONLY_HINT,
  hasLatestExecutableSnapshot,
  isHistoricalSnapshotReadonly,
} from '@/utils/runtimeSnapshot';
import useThreadDetail from '@/hooks/useThreadDetail';
import useThreadResponsePolling from '@/hooks/useThreadResponsePolling';
import useThreadRecommendedQuestionsPolling from '@/hooks/useThreadRecommendedQuestionsPolling';
import ThreadConversationStage from '@/features/home/thread/components/ThreadConversationStage';
import ThreadPageOverlays from '@/features/home/thread/components/ThreadPageOverlays';
import { useThreadPageDisplayState } from '@/features/home/thread/useThreadPageDisplayState';
import { useThreadRecoveryOrchestration } from '@/features/home/thread/useThreadRecoveryOrchestration';
import { useThreadCreateResponseAction } from '@/features/home/thread/useThreadCreateResponseAction';
import { useThreadRecommendedQuestionsAction } from '@/features/home/thread/useThreadRecommendedQuestionsAction';
import { useThreadResponseArtifactActions } from '@/features/home/thread/useThreadResponseArtifactActions';
import { useThreadResponseMutationActions } from '@/features/home/thread/useThreadResponseMutationActions';

export {
  buildPendingPromptThreadResponse,
  findLatestPollableThreadResponse,
  findLatestUnfinishedAskingResponse,
  hasActivePromptAskingTask,
  hydrateCreatedThreadResponse,
  resolveThreadRecoveryPlan,
  resolveCreatedThreadResponsePollingTaskId,
  shouldSuspendThreadRecoveryDuringPromptFlow,
} from '@/features/home/thread/threadPageState';

const THREAD_RESPONSE_POLL_INTERVAL_MS = 1500;
const THREAD_RECOMMEND_POLL_INTERVAL_MS = 1500;

const reportThreadError = (_error: unknown, fallbackMessage: string) => {
  message.error(fallbackMessage);
};

export default function HomeThread() {
  const $prompt = useRef<ComponentRef<typeof Prompt>>(null);
  const router = useRouter();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const threadId = useMemo(() => {
    const routeId = Number(router.query.id as string);
    if (routeId) {
      return routeId;
    }

    const browserPath =
      typeof window !== 'undefined' ? window.location.pathname : '';
    const matchedId = `${router.asPath} ${browserPath}`.match(
      /\/home\/(\d+)/,
    )?.[1];
    return matchedId ? Number(matchedId) : null;
  }, [router.asPath, router.query.id]);
  const saveAsViewModal = useModalAction();
  const questionSqlPairModal = useModalAction();
  const adjustReasoningStepsModal = useModalAction();
  const adjustSqlModal = useModalAction();
  const runtimeSelector = useRuntimeSelectorState();
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState;
  const selectorHasRuntime = Boolean(
    runtimeScopeNavigation.selector.deployHash ||
    runtimeScopeNavigation.selector.kbSnapshotId ||
    runtimeScopeNavigation.selector.runtimeScopeId ||
    runtimeSelectorState?.currentKbSnapshot?.deployHash ||
    runtimeSelectorState?.currentKbSnapshot?.id,
  );
  const hasExecutableRuntime = useMemo(() => {
    return hasLatestExecutableSnapshot({
      selectorHasRuntime,
      currentKbSnapshotId: runtimeSelectorState?.currentKbSnapshot?.id,
      defaultKbSnapshotId:
        runtimeSelectorState?.currentKnowledgeBase?.defaultKbSnapshotId,
    });
  }, [runtimeSelectorState, selectorHasRuntime]);
  const isHistoricalRuntimeReadonly = useMemo(() => {
    return isHistoricalSnapshotReadonly({
      selectorHasRuntime,
      currentKbSnapshotId: runtimeSelectorState?.currentKbSnapshot?.id,
      defaultKbSnapshotId:
        runtimeSelectorState?.currentKnowledgeBase?.defaultKbSnapshotId,
    });
  }, [runtimeSelectorState, selectorHasRuntime]);

  const [showRecommendedQuestions, setShowRecommendedQuestions] =
    useState<boolean>(false);

  const {
    data,
    loading: threadLoading,
    updateQuery: updateThreadQuery,
  } = useThreadDetail({
    threadId,
    enabled: runtimeScopePage.hasRuntimeScope,
    runtimeScopeSelector: runtimeScopeNavigation.selector,
    onError: (error) => {
      reportThreadError(error, '加载对话失败，已返回首页');
      runtimeScopeNavigation.pushWorkspace(Path.Home);
    },
  });
  const askPrompt = useAskPrompt(
    threadId ?? undefined,
    undefined,
    updateThreadQuery,
  );
  const adjustAnswer = useAdjustAnswer(
    threadId ?? undefined,
    updateThreadQuery,
    runtimeScopeNavigation.selector,
  );
  const upsertThreadResponse = useCallback(
    (nextResponse: ThreadResponse) => {
      updateThreadQuery((prev) => {
        const hasMatchedResponse = prev.thread.responses.some(
          (response) => response.id === nextResponse.id,
        );

        return {
          ...prev,
          thread: {
            ...prev.thread,
            responses: hasMatchedResponse
              ? prev.thread.responses.map((response) =>
                  response.id === nextResponse.id ? nextResponse : response,
                )
              : [...prev.thread.responses, nextResponse],
          },
        };
      });
    },
    [updateThreadQuery],
  );
  const {
    data: pollingResponse,
    fetchById: fetchThreadResponse,
    stopPolling: stopThreadResponseHookPolling,
  } = useThreadResponsePolling({
    runtimeScopeSelector: runtimeScopeNavigation.selector,
    pollInterval: THREAD_RESPONSE_POLL_INTERVAL_MS,
    onCompleted(nextResponse) {
      upsertThreadResponse(nextResponse);
    },
    onError: (error) => {
      reportThreadError(error, '加载对话结果失败，请稍后重试');
    },
  });

  const {
    data: recommendedQuestions,
    fetchByThreadId: fetchThreadRecommendationQuestions,
    stopPolling: stopThreadRecommendationQuestionsHookPolling,
  } = useThreadRecommendedQuestionsPolling({
    runtimeScopeSelector: runtimeScopeNavigation.selector,
    pollInterval: THREAD_RECOMMEND_POLL_INTERVAL_MS,
    onError: (error) => {
      reportThreadError(error, '加载推荐追问失败，请稍后重试');
    },
  });

  const thread = useMemo(() => data?.thread || null, [data]);
  const runtimeKnowledgeBases = runtimeSelectorState?.knowledgeBases || [];
  const shouldForceReferencePreview = useMemo(() => {
    const raw = router.query.referencePreview;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value === '1';
  }, [router.query.referencePreview]);
  const {
    displayThread,
    primaryQuestion,
    responses,
    selectedKnowledgeBaseNames,
    shouldUseReferencePreview,
  } = useThreadPageDisplayState({
    askPromptAskingTask: askPrompt.data?.askingTask,
    askPromptLoading: askPrompt.loading,
    askPromptOriginalQuestion: askPrompt.data?.originalQuestion,
    rawKnowledgeBaseIds: router.query.knowledgeBaseIds,
    runtimeKnowledgeBases,
    shouldForceReferencePreview,
    thread,
    threadId,
  });
  const {
    pollingAskingTaskIdRef,
    pollingResponseIdRef,
    scheduleThreadRecommendPollingStop,
    startThreadResponsePolling,
    stopThreadRecommendPolling,
    stopThreadResponsePolling,
    threadRecommendRequestInFlightRef,
    threadResponseRequestInFlightRef,
  } = useThreadRecoveryOrchestration({
    askPrompt,
    fetchThreadResponse,
    hasExecutableRuntime,
    onThreadResponseSettled: () => {
      setShowRecommendedQuestions(true);
    },
    pollingResponse,
    promptRef: $prompt,
    recommendedQuestionsStatus: recommendedQuestions?.status,
    responses,
    stopThreadRecommendationQuestionsHookPolling,
    stopThreadResponseHookPolling,
    threadId,
  });
  const onCreateResponse = useThreadCreateResponseAction({
    askPrompt,
    currentThreadId: thread?.id,
    pollingAskingTaskIdRef,
    pollingResponseIdRef,
    runtimeScopeSelector: runtimeScopeNavigation.selector,
    setShowRecommendedQuestions,
    stopThreadResponsePolling,
    threadResponseRequestInFlightRef,
    upsertThreadResponse,
  });
  const onGenerateThreadRecommendedQuestions =
    useThreadRecommendedQuestionsAction({
      currentThreadId: thread?.id ?? threadId,
      fetchThreadRecommendationQuestions,
      runtimeScopeSelector: runtimeScopeNavigation.selector,
      scheduleThreadRecommendPollingStop,
      setShowRecommendedQuestions,
      stopThreadRecommendPolling,
      threadRecommendRequestInFlightRef,
    });
  const {
    createSqlPairLoading,
    creating,
    handleCreateSqlPair,
    handleCreateView,
  } = useThreadResponseArtifactActions({
    runtimeScopeSelector: runtimeScopeNavigation.selector,
  });
  const {
    onAdjustThreadResponseChart,
    onFixSQLStatement,
    onGenerateThreadResponseAnswer,
    onGenerateThreadResponseChart,
    threadResponseUpdating,
  } = useThreadResponseMutationActions({
    runtimeScopeSelector: runtimeScopeNavigation.selector,
    startThreadResponsePolling,
    upsertThreadResponse,
  });

  const providerDataValue = useMemo(() => {
    if (!displayThread) {
      return null;
    }

    return {
      data: displayThread as IPromptThreadStore['data'],
      recommendedQuestions:
        (recommendedQuestions as IPromptThreadStore['recommendedQuestions']) ||
        null,
      showRecommendedQuestions,
    };
  }, [displayThread, recommendedQuestions, showRecommendedQuestions]);

  const providerPreparationValue = useMemo(
    () => ({
      preparation: {
        askingStreamTask: askPrompt.data?.askingStreamTask,
        onStopAskingTask: askPrompt.onStop,
        onReRunAskingTask: askPrompt.onReRun,
        onStopAdjustTask: adjustAnswer.onStop,
        onReRunAdjustTask: adjustAnswer.onReRun,
        onFixSQLStatement,
        fixStatementLoading: threadResponseUpdating,
      },
    }),
    [
      adjustAnswer.onReRun,
      adjustAnswer.onStop,
      askPrompt.data?.askingStreamTask,
      askPrompt.onReRun,
      askPrompt.onStop,
      onFixSQLStatement,
      threadResponseUpdating,
    ],
  );

  const providerActionsValue = useMemo(
    () => ({
      onOpenSaveAsViewModal: saveAsViewModal.openModal,
      onSelectRecommendedQuestion: onCreateResponse,
      onGenerateThreadRecommendedQuestions,
      onGenerateTextBasedAnswer: onGenerateThreadResponseAnswer,
      onGenerateChartAnswer: onGenerateThreadResponseChart,
      onAdjustChartAnswer: onAdjustThreadResponseChart,
      onOpenSaveToKnowledgeModal: questionSqlPairModal.openModal,
      onOpenAdjustReasoningStepsModal: adjustReasoningStepsModal.openModal,
      onOpenAdjustSQLModal: adjustSqlModal.openModal,
    }),
    [
      onAdjustThreadResponseChart,
      onCreateResponse,
      onGenerateThreadRecommendedQuestions,
      onGenerateThreadResponseAnswer,
      onGenerateThreadResponseChart,
      questionSqlPairModal.openModal,
      saveAsViewModal.openModal,
      adjustReasoningStepsModal.openModal,
      adjustSqlModal.openModal,
    ],
  );

  const threadPageLoading =
    runtimeScopePage.guarding || threadLoading || !providerDataValue;

  return (
    <ThreadPageShell
      threadId={threadId}
      title={primaryQuestion}
      loading={threadPageLoading}
      onNavigate={runtimeScopeNavigation.pushWorkspace}
    >
      {providerDataValue ? (
        <PromptThreadProvider
          dataValue={providerDataValue}
          preparationValue={providerPreparationValue}
          actionsValue={providerActionsValue}
        >
          <ThreadConversationStage
            promptRef={$prompt}
            primaryQuestion={primaryQuestion}
            selectedKnowledgeBaseNames={selectedKnowledgeBaseNames}
            shouldUseReferencePreview={shouldUseReferencePreview}
            hasExecutableRuntime={hasExecutableRuntime}
            readonlyHint={HISTORICAL_SNAPSHOT_READONLY_HINT}
            unavailableHint="当前知识库暂不可继续追问，请先确认已接入可用数据资产。"
            isHistoricalRuntimeReadonly={isHistoricalRuntimeReadonly}
            onCreateResponse={onCreateResponse}
            promptProps={askPrompt}
          />
          <ThreadPageOverlays
            saveAsViewModalProps={{
              ...saveAsViewModal.state,
              loading: creating,
              onClose: saveAsViewModal.closeModal,
              onSubmit: handleCreateView,
            }}
            questionSqlPairModalProps={{
              ...questionSqlPairModal.state,
              onClose: questionSqlPairModal.closeModal,
              loading: createSqlPairLoading,
              onSubmit: async ({ data }: { data: CreateSqlPairInput }) => {
                await handleCreateSqlPair(data);
              },
            }}
            adjustReasoningStepsModalProps={{
              ...adjustReasoningStepsModal.state,
              onClose: adjustReasoningStepsModal.closeModal,
              loading: adjustAnswer.loading,
              onSubmit: async (values) => {
                await adjustAnswer.onAdjustReasoningSteps(
                  values.responseId,
                  values.data,
                );
              },
            }}
            adjustSqlModalProps={{
              ...adjustSqlModal.state,
              onClose: adjustSqlModal.closeModal,
              loading: adjustAnswer.loading,
              onSubmit: async (values) =>
                await adjustAnswer.onAdjustSQL(values.responseId, values.sql),
            }}
          />
        </PromptThreadProvider>
      ) : null}
    </ThreadPageShell>
  );
}
