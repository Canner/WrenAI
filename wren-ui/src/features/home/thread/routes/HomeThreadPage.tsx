import { appMessage as message } from '@/utils/antdAppBridge';
import { CreateSqlPairInput } from '@/types/knowledge';
import { useRouter } from 'next/router';
import {
  ComponentRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ThreadResponse } from '@/types/home';
import { RecommendedQuestionsTaskStatus } from '@/types/home';

import { Path } from '@/utils/enum';
import Prompt from '@/components/pages/home/prompt';
import useAskPrompt, { getIsFinished } from '@/hooks/useAskPrompt';
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
import ThreadWorkbench from '@/features/home/thread/components/ThreadWorkbench';
import { resolveComposerIntent } from '@/features/home/thread/homeIntentRouting';
import {
  type WorkbenchArtifactKind,
  isRenderableWorkbenchArtifact,
  resolveFallbackWorkbenchArtifact,
  resolvePrimaryWorkbenchArtifact,
} from '@/features/home/thread/threadWorkbenchState';
import type { ComposerDraftIntent } from '@/types/homeIntent';
import { useThreadPageDisplayState } from '@/features/home/thread/useThreadPageDisplayState';
import { useThreadRecoveryOrchestration } from '@/features/home/thread/useThreadRecoveryOrchestration';
import { useThreadCreateResponseAction } from '@/features/home/thread/useThreadCreateResponseAction';
import { useThreadRecommendedQuestionsAction } from '@/features/home/thread/useThreadRecommendedQuestionsAction';
import { useThreadResponseArtifactActions } from '@/features/home/thread/useThreadResponseArtifactActions';
import { useThreadResponseMutationActions } from '@/features/home/thread/useThreadResponseMutationActions';
import {
  consumeThreadWorkbenchNavigationHint,
  type ThreadWorkbenchNavigationHint,
} from '@/features/home/thread/threadWorkbenchNavigationHint';
import {
  clearPersistedThreadWorkbenchState,
  persistThreadWorkbenchState,
  readPersistedThreadWorkbenchState,
  resolveRestoredThreadWorkbenchState,
  type PersistedThreadWorkbenchState,
} from '@/features/home/thread/threadWorkbenchReplayState';
import { resolveThreadResponseRuntimeSelector } from '@/features/home/thread/threadResponseRuntime';

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
  const [
    recommendedQuestionsOwnerThreadId,
    setRecommendedQuestionsOwnerThreadId,
  ] = useState<number | null>(null);
  const [
    recommendedQuestionsOwnerResponseId,
    setRecommendedQuestionsOwnerResponseId,
  ] = useState<number | null>(null);
  const [composerDraftIntent, setComposerDraftIntent] =
    useState<ComposerDraftIntent | null>(null);
  const [selectedResponseId, setSelectedResponseId] = useState<number | null>(
    null,
  );
  const [activeWorkbenchArtifact, setActiveWorkbenchArtifact] =
    useState<WorkbenchArtifactKind | null>(null);
  const [isWorkbenchOpen, setIsWorkbenchOpen] = useState(false);
  const autoCreateResponseTaskIdRef = useRef<string | null>(null);
  const workbenchReadyStateRef = useRef<{
    responseId: number | null;
    artifact: WorkbenchArtifactKind | null;
    initialized: boolean;
  }>({
    responseId: null,
    artifact: null,
    initialized: false,
  });
  const threadWorkbenchNavigationHintRef =
    useRef<ThreadWorkbenchNavigationHint | null>(null);
  const restoredWorkbenchStateRef =
    useRef<PersistedThreadWorkbenchState | null>(null);
  const isRestoringWorkbenchStateRef = useRef(false);
  const hydratedRecommendationRequestKeyRef = useRef<string | null>(null);
  const latestResponseAutoSelectionRef = useRef<{
    threadId: number | null;
    latestResponseId: number | null;
    responseCount: number;
  }>({
    threadId: null,
    latestResponseId: null,
    responseCount: 0,
  });

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
    fetchById: fetchThreadResponseById,
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
    loading: recommendedQuestionsLoading,
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
  const resolveResponseRuntimeScopeSelectorById = useCallback(
    (responseId: number) => {
      const matchedResponse =
        responses.find((response) => response.id === responseId) || null;
      return resolveThreadResponseRuntimeSelector({
        response: matchedResponse,
        fallbackSelector: runtimeScopeNavigation.selector,
      });
    },
    [responses, runtimeScopeNavigation.selector],
  );
  const fetchThreadResponse = useCallback(
    (responseId: number) =>
      fetchThreadResponseById(
        responseId,
        resolveResponseRuntimeScopeSelectorById(responseId),
      ),
    [fetchThreadResponseById, resolveResponseRuntimeScopeSelectorById],
  );
  const adjustAnswer = useAdjustAnswer(
    threadId ?? undefined,
    updateThreadQuery,
    runtimeScopeNavigation.selector,
    resolveResponseRuntimeScopeSelectorById,
  );
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
  const latestResponseForRecommendations =
    responses[responses.length - 1] || null;
  const handleGenerateThreadRecommendedQuestions = useCallback(
    async (options?: {
      sourceResponseId?: number | null;
      sourceThreadId?: number | null;
    }) => {
      const currentRecommendationThreadId =
        options?.sourceThreadId ?? thread?.id ?? threadId ?? null;
      const nextOwnerResponseId =
        options?.sourceResponseId ??
        latestResponseForRecommendations?.id ??
        null;

      hydratedRecommendationRequestKeyRef.current =
        currentRecommendationThreadId != null && nextOwnerResponseId != null
          ? `${currentRecommendationThreadId}:${nextOwnerResponseId}`
          : null;
      if (currentRecommendationThreadId != null) {
        setRecommendedQuestionsOwnerThreadId(currentRecommendationThreadId);
      }
      setRecommendedQuestionsOwnerResponseId(nextOwnerResponseId);
      await onGenerateThreadRecommendedQuestions();
    },
    [
      latestResponseForRecommendations?.id,
      onGenerateThreadRecommendedQuestions,
      thread?.id,
      threadId,
    ],
  );
  const recommendationThreadId = displayThread?.id ?? thread?.id ?? threadId;
  const shouldShowRecommendationLoadingState = useMemo(() => {
    if (
      !showRecommendedQuestions ||
      recommendedQuestionsOwnerResponseId == null
    ) {
      return false;
    }

    return recommendedQuestionsLoading && !recommendedQuestions;
  }, [
    recommendedQuestions,
    recommendedQuestionsLoading,
    recommendedQuestionsOwnerResponseId,
    showRecommendedQuestions,
  ]);
  const {
    createSqlPairLoading,
    creating,
    handleCreateSqlPair,
    handleCreateView,
  } = useThreadResponseArtifactActions({
    runtimeScopeSelector: runtimeScopeNavigation.selector,
    resolveResponseRuntimeScopeSelector:
      resolveResponseRuntimeScopeSelectorById,
  });
  const {
    onAdjustThreadResponseChart,
    onFixSQLStatement,
    onGenerateThreadResponseAnswer,
    onGenerateThreadResponseChart,
    threadResponseUpdating,
  } = useThreadResponseMutationActions({
    currentResponses: displayThread?.responses || [],
    currentThreadId: thread?.id,
    onSelectResponse: (responseId, options) => {
      setSelectedResponseId(responseId);
      const matchedResponse =
        displayThread?.responses.find(
          (response) => response.id === responseId,
        ) || null;
      const requestedArtifact = options?.artifact ?? null;
      const nextArtifact =
        requestedArtifact &&
        matchedResponse &&
        isRenderableWorkbenchArtifact(matchedResponse, requestedArtifact)
          ? requestedArtifact
          : resolveFallbackWorkbenchArtifact(matchedResponse);

      setActiveWorkbenchArtifact(requestedArtifact || nextArtifact);
      setIsWorkbenchOpen((current) => {
        if (options?.openWorkbench === true) {
          return Boolean(nextArtifact);
        }

        if (options?.openWorkbench === false) {
          return false;
        }

        return current ? Boolean(nextArtifact) : current;
      });
    },
    runtimeScopeSelector: runtimeScopeNavigation.selector,
    startThreadResponsePolling,
    upsertThreadResponse,
  });

  useEffect(() => {
    setShowRecommendedQuestions(false);
    setRecommendedQuestionsOwnerThreadId(null);
    setRecommendedQuestionsOwnerResponseId(null);
    setComposerDraftIntent(null);
    setSelectedResponseId(null);
    setActiveWorkbenchArtifact(null);
    setIsWorkbenchOpen(false);
    autoCreateResponseTaskIdRef.current = null;
    hydratedRecommendationRequestKeyRef.current = null;
    restoredWorkbenchStateRef.current =
      readPersistedThreadWorkbenchState(threadId);
    isRestoringWorkbenchStateRef.current = Boolean(
      restoredWorkbenchStateRef.current,
    );
    threadWorkbenchNavigationHintRef.current =
      consumeThreadWorkbenchNavigationHint(threadId);
    workbenchReadyStateRef.current = {
      responseId: null,
      artifact: null,
      initialized: false,
    };
    latestResponseAutoSelectionRef.current = {
      threadId: threadId ?? null,
      latestResponseId: null,
      responseCount: 0,
    };
  }, [threadId]);

  useEffect(() => {
    const displayResponses = displayThread?.responses || [];
    const latestResponseId =
      displayResponses[displayResponses.length - 1]?.id ?? null;
    const previous = latestResponseAutoSelectionRef.current;
    const threadChanged = previous.threadId !== (threadId ?? null);

    if (threadChanged) {
      latestResponseAutoSelectionRef.current = {
        threadId: threadId ?? null,
        latestResponseId,
        responseCount: displayResponses.length,
      };
      return;
    }

    const appendedNewResponse =
      displayResponses.length > previous.responseCount &&
      latestResponseId != null &&
      latestResponseId !== previous.latestResponseId;

    if (appendedNewResponse) {
      setSelectedResponseId(latestResponseId);
    }

    latestResponseAutoSelectionRef.current = {
      threadId: threadId ?? null,
      latestResponseId,
      responseCount: displayResponses.length,
    };
  }, [displayThread?.responses, threadId]);

  useEffect(() => {
    const askingTask = askPrompt.data?.askingTask;
    const taskId = askingTask?.queryId || null;
    if (!thread?.id || !taskId || !getIsFinished(askingTask?.status)) {
      if (
        autoCreateResponseTaskIdRef.current &&
        autoCreateResponseTaskIdRef.current !== taskId
      ) {
        autoCreateResponseTaskIdRef.current = null;
      }
      return;
    }

    const hasPersistedResponse = responses.some(
      (response) => response.askingTask?.queryId === taskId,
    );

    if (hasPersistedResponse) {
      if (autoCreateResponseTaskIdRef.current === taskId) {
        autoCreateResponseTaskIdRef.current = null;
      }
      return;
    }

    if (autoCreateResponseTaskIdRef.current === taskId) {
      return;
    }

    autoCreateResponseTaskIdRef.current = taskId;
    void onCreateResponse({
      question: askPrompt.data?.originalQuestion || '',
      taskId,
    });
  }, [
    askPrompt.data?.askingTask,
    askPrompt.data?.originalQuestion,
    onCreateResponse,
    responses,
    thread?.id,
  ]);

  useEffect(() => {
    if (
      !showRecommendedQuestions ||
      !recommendationThreadId ||
      recommendedQuestionsOwnerResponseId == null
    ) {
      return;
    }

    const hasMatchingRecommendedQuestions =
      recommendedQuestions?.resolvedIntent?.kind === 'RECOMMEND_QUESTIONS' &&
      recommendedQuestions.resolvedIntent.sourceThreadId ===
        recommendedQuestionsOwnerThreadId &&
      recommendedQuestions.resolvedIntent.sourceResponseId ===
        recommendedQuestionsOwnerResponseId;

    if (hasMatchingRecommendedQuestions) {
      return;
    }

    const requestKey = `${recommendationThreadId}:${recommendedQuestionsOwnerResponseId}`;
    if (hydratedRecommendationRequestKeyRef.current === requestKey) {
      return;
    }

    hydratedRecommendationRequestKeyRef.current = requestKey;
    void fetchThreadRecommendationQuestions(recommendationThreadId).finally(
      () => {
        scheduleThreadRecommendPollingStop();
      },
    );
  }, [
    fetchThreadRecommendationQuestions,
    recommendationThreadId,
    recommendedQuestions,
    recommendedQuestionsOwnerThreadId,
    recommendedQuestionsOwnerResponseId,
    scheduleThreadRecommendPollingStop,
    showRecommendedQuestions,
  ]);

  useEffect(() => {
    const intent = recommendedQuestions?.resolvedIntent;
    if (intent?.kind !== 'RECOMMEND_QUESTIONS') {
      return;
    }

    if (intent.sourceThreadId != null) {
      setRecommendedQuestionsOwnerThreadId(intent.sourceThreadId);
    }

    if (intent.sourceResponseId != null) {
      setRecommendedQuestionsOwnerResponseId(intent.sourceResponseId);
    }
  }, [
    recommendedQuestions?.resolvedIntent?.kind,
    recommendedQuestions?.resolvedIntent?.sourceResponseId,
    recommendedQuestions?.resolvedIntent?.sourceThreadId,
  ]);

  useEffect(() => {
    if (!displayThread) {
      return;
    }

    const displayResponses = displayThread.responses || [];
    if (displayResponses.length === 0) {
      if (typeof threadId === 'number') {
        clearPersistedThreadWorkbenchState(threadId);
      }
      restoredWorkbenchStateRef.current = null;
      isRestoringWorkbenchStateRef.current = false;
      setSelectedResponseId(null);
      setActiveWorkbenchArtifact(null);
      setIsWorkbenchOpen(false);
      return;
    }

    const restoredWorkbenchState = resolveRestoredThreadWorkbenchState({
      persistedState: restoredWorkbenchStateRef.current,
      responses: displayResponses,
    });
    if (restoredWorkbenchStateRef.current && !restoredWorkbenchState) {
      restoredWorkbenchStateRef.current = null;
      isRestoringWorkbenchStateRef.current = false;
    }

    setSelectedResponseId((current) => {
      if (
        current != null &&
        displayResponses.some((response) => response.id === current)
      ) {
        return current;
      }

      if (restoredWorkbenchState?.selectedResponseId != null) {
        return restoredWorkbenchState.selectedResponseId;
      }

      return displayResponses[displayResponses.length - 1]?.id ?? null;
    });
  }, [displayThread, displayThread?.responses, threadId]);

  const selectedResponse = useMemo(() => {
    const displayResponses = displayThread?.responses || [];
    if (displayResponses.length === 0) {
      return null;
    }

    return (
      displayResponses.find((response) => response.id === selectedResponseId) ||
      displayResponses[displayResponses.length - 1] ||
      null
    );
  }, [displayThread?.responses, selectedResponseId]);

  const selectedResponsePrimaryArtifact = useMemo(
    () => resolvePrimaryWorkbenchArtifact(selectedResponse),
    [selectedResponse],
  );
  const selectedResponseFallbackArtifact = useMemo(
    () => resolveFallbackWorkbenchArtifact(selectedResponse),
    [selectedResponse],
  );
  const latestDisplayResponseId =
    displayThread?.responses[displayThread.responses.length - 1]?.id ?? null;
  const isSelectedLatestResponse =
    selectedResponse?.id != null &&
    selectedResponse.id === latestDisplayResponseId;

  useEffect(() => {
    if (!selectedResponse) {
      setActiveWorkbenchArtifact(null);
      setIsWorkbenchOpen(false);
      workbenchReadyStateRef.current = {
        responseId: null,
        artifact: null,
        initialized: true,
      };
      return;
    }

    const nextArtifact =
      selectedResponsePrimaryArtifact || selectedResponseFallbackArtifact;
    const threadWorkbenchNavigationHint =
      threadWorkbenchNavigationHintRef.current;
    const restoredWorkbenchState = resolveRestoredThreadWorkbenchState({
      persistedState: restoredWorkbenchStateRef.current,
      responses: displayThread?.responses || [],
    });
    const hintedArtifact =
      threadWorkbenchNavigationHint?.preferredArtifact &&
      isRenderableWorkbenchArtifact(
        selectedResponse,
        threadWorkbenchNavigationHint.preferredArtifact,
      )
        ? threadWorkbenchNavigationHint.preferredArtifact
        : nextArtifact;
    const shouldAutoOpenFromNavigationHint = Boolean(
      threadWorkbenchNavigationHint &&
      threadId === threadWorkbenchNavigationHint.threadId &&
      isSelectedLatestResponse &&
      hintedArtifact,
    );
    const shouldApplyRestoredWorkbenchState = Boolean(
      restoredWorkbenchState &&
      selectedResponse.id === restoredWorkbenchState.selectedResponseId,
    );
    const previous = workbenchReadyStateRef.current;
    const selectedResponseChanged = previous.responseId !== selectedResponse.id;
    const primaryArtifactPromoted =
      previous.initialized &&
      previous.responseId === selectedResponse.id &&
      previous.artifact !== nextArtifact &&
      Boolean(nextArtifact);

    setActiveWorkbenchArtifact((current) => {
      if (shouldApplyRestoredWorkbenchState) {
        return restoredWorkbenchState?.activeArtifact ?? null;
      }

      if (shouldAutoOpenFromNavigationHint) {
        return hintedArtifact;
      }

      if (selectedResponseChanged || primaryArtifactPromoted) {
        return nextArtifact;
      }

      if (current === 'chart') {
        return current;
      }

      if (current && isRenderableWorkbenchArtifact(selectedResponse, current)) {
        return current;
      }

      return nextArtifact;
    });

    setIsWorkbenchOpen((current) => {
      if (shouldApplyRestoredWorkbenchState) {
        return restoredWorkbenchState?.isOpen ?? false;
      }

      if (shouldAutoOpenFromNavigationHint) {
        return true;
      }

      if (
        isSelectedLatestResponse &&
        nextArtifact &&
        (selectedResponseChanged || primaryArtifactPromoted)
      ) {
        return true;
      }

      return current ? Boolean(nextArtifact) : current;
    });

    if (!previous.initialized) {
      if (shouldAutoOpenFromNavigationHint) {
        threadWorkbenchNavigationHintRef.current = null;
      }
      workbenchReadyStateRef.current = {
        responseId: selectedResponse.id,
        artifact: nextArtifact,
        initialized: true,
      };
      return;
    }

    const artifactBecameReady = !previous.artifact && Boolean(nextArtifact);
    if (
      isSelectedLatestResponse &&
      nextArtifact &&
      (artifactBecameReady ||
        selectedResponseChanged ||
        primaryArtifactPromoted)
    ) {
      setIsWorkbenchOpen(true);
    }

    if (shouldAutoOpenFromNavigationHint) {
      threadWorkbenchNavigationHintRef.current = null;
    }

    workbenchReadyStateRef.current = {
      responseId: selectedResponse.id,
      artifact: nextArtifact,
      initialized: true,
    };
  }, [
    displayThread?.responses,
    isSelectedLatestResponse,
    selectedResponse,
    selectedResponseFallbackArtifact,
    selectedResponsePrimaryArtifact,
    threadId,
  ]);

  useEffect(() => {
    if (
      typeof threadId !== 'number' ||
      typeof selectedResponseId !== 'number'
    ) {
      return;
    }

    if (isRestoringWorkbenchStateRef.current) {
      const restoredWorkbenchState = resolveRestoredThreadWorkbenchState({
        persistedState: restoredWorkbenchStateRef.current,
        responses: displayThread?.responses || [],
      });

      if (!restoredWorkbenchState) {
        restoredWorkbenchStateRef.current = null;
        isRestoringWorkbenchStateRef.current = false;
        return;
      }

      const restoredStateApplied =
        restoredWorkbenchState.selectedResponseId === selectedResponseId &&
        restoredWorkbenchState.activeArtifact === activeWorkbenchArtifact &&
        restoredWorkbenchState.isOpen === isWorkbenchOpen;

      if (!restoredStateApplied) {
        return;
      }

      restoredWorkbenchStateRef.current = null;
      isRestoringWorkbenchStateRef.current = false;
    }

    persistThreadWorkbenchState({
      threadId,
      selectedResponseId,
      activeArtifact: activeWorkbenchArtifact,
      isOpen: isWorkbenchOpen,
    });
  }, [
    activeWorkbenchArtifact,
    displayThread?.responses,
    isWorkbenchOpen,
    selectedResponseId,
    threadId,
  ]);

  const handleSelectResponse = useCallback(
    (
      responseId: number,
      options?: {
        artifact?: WorkbenchArtifactKind | null;
        openWorkbench?: boolean;
        userInitiated?: boolean;
      },
    ) => {
      const matchedResponse =
        displayThread?.responses.find(
          (response) => response.id === responseId,
        ) || null;
      const requestedArtifact = options?.artifact ?? null;
      const nextArtifact =
        requestedArtifact &&
        matchedResponse &&
        isRenderableWorkbenchArtifact(matchedResponse, requestedArtifact)
          ? requestedArtifact
          : resolveFallbackWorkbenchArtifact(matchedResponse);

      setSelectedResponseId(responseId);
      setActiveWorkbenchArtifact(requestedArtifact || nextArtifact);
      setIsWorkbenchOpen((current) => {
        if (options?.openWorkbench === true) {
          return Boolean(nextArtifact);
        }

        if (options?.openWorkbench === false) {
          return false;
        }

        return current ? Boolean(nextArtifact) : current;
      });
    },
    [displayThread?.responses],
  );

  const handleDraftConversationAid = useCallback(
    ({
      intentHint,
      prompt,
      sourceAidKind,
      sourceResponseId,
    }: {
      intentHint: ComposerDraftIntent['intentHint'];
      prompt: string;
      sourceAidKind?: ComposerDraftIntent['sourceAidKind'];
      sourceResponseId?: number | null;
    }) => {
      const nextDraftIntent: ComposerDraftIntent = {
        draftKey: `${sourceResponseId ?? 'thread'}:${sourceAidKind ?? intentHint}:${Date.now()}`,
        draftedAt: new Date().toISOString(),
        draftedPrompt: prompt,
        intentHint,
        sourceAidKind: sourceAidKind ?? null,
        sourceResponseId: sourceResponseId ?? null,
      };
      setComposerDraftIntent(nextDraftIntent);
      $prompt.current?.setDraft(prompt);
    },
    [],
  );

  const handlePromptSubmit = useCallback(
    async (value: string) => {
      const composerIntent = resolveComposerIntent({
        draftIntent: composerDraftIntent,
        question: value,
        responses: displayThread?.responses || [],
        selectedResponseId,
      });
      setComposerDraftIntent(null);

      if (composerIntent.resolvedIntent.kind === 'RECOMMEND_QUESTIONS') {
        await handleGenerateThreadRecommendedQuestions({
          sourceResponseId: composerIntent.sourceResponseId,
          sourceThreadId: composerIntent.resolvedIntent.sourceThreadId,
        });
        return {
          handledInlineResult: true,
        };
      }

      if (
        composerIntent.resolvedIntent.kind === 'CHART' &&
        composerIntent.sourceResponseId
      ) {
        await onGenerateThreadResponseChart(composerIntent.sourceResponseId, {
          question: value.trim(),
          sourceResponseId: composerIntent.sourceResponseId,
        });

        return {
          handledInlineResult: true,
        };
      }

      await askPrompt.onSubmit(value);
      return undefined;
    },
    [
      askPrompt,
      composerDraftIntent,
      displayThread?.responses,
      handleGenerateThreadRecommendedQuestions,
      onGenerateThreadResponseChart,
      selectedResponseId,
    ],
  );

  const shouldRenderWorkbench = useMemo(() => {
    if (!isWorkbenchOpen || !selectedResponse) {
      return false;
    }

    const nextArtifact =
      activeWorkbenchArtifact &&
      isRenderableWorkbenchArtifact(selectedResponse, activeWorkbenchArtifact)
        ? activeWorkbenchArtifact
        : selectedResponseFallbackArtifact;

    return Boolean(nextArtifact);
  }, [
    activeWorkbenchArtifact,
    isWorkbenchOpen,
    selectedResponse,
    selectedResponseFallbackArtifact,
  ]);

  const providerDataValue = useMemo(() => {
    if (!displayThread) {
      return null;
    }

    const effectiveRecommendedQuestions =
      (recommendedQuestionsOwnerThreadId === recommendationThreadId
        ? (recommendedQuestions as IPromptThreadStore['recommendedQuestions'])
        : null) ||
      (shouldShowRecommendationLoadingState
        ? {
            status: RecommendedQuestionsTaskStatus.GENERATING,
            questions: [],
          }
        : null);

    return {
      data: displayThread as IPromptThreadStore['data'],
      recommendedQuestions: effectiveRecommendedQuestions,
      recommendedQuestionsOwnerResponseId,
      selectedResponseId,
      showRecommendedQuestions,
    };
  }, [
    displayThread,
    recommendedQuestions,
    recommendedQuestionsLoading,
    recommendedQuestionsOwnerResponseId,
    recommendedQuestionsOwnerThreadId,
    selectedResponseId,
    showRecommendedQuestions,
    shouldShowRecommendationLoadingState,
  ]);

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
      onDraftConversationAid: handleDraftConversationAid,
      onGenerateThreadRecommendedQuestions:
        handleGenerateThreadRecommendedQuestions,
      onGenerateTextBasedAnswer: onGenerateThreadResponseAnswer,
      onGenerateChartAnswer: onGenerateThreadResponseChart,
      onAdjustChartAnswer: onAdjustThreadResponseChart,
      onSelectResponse: handleSelectResponse,
      onOpenSaveToKnowledgeModal: questionSqlPairModal.openModal,
      onOpenAdjustReasoningStepsModal: adjustReasoningStepsModal.openModal,
      onOpenAdjustSQLModal: adjustSqlModal.openModal,
    }),
    [
      onAdjustThreadResponseChart,
      onCreateResponse,
      handleDraftConversationAid,
      handleGenerateThreadRecommendedQuestions,
      onGenerateThreadResponseAnswer,
      onGenerateThreadResponseChart,
      handleSelectResponse,
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
            promptProps={{
              ...askPrompt,
              onSubmit: handlePromptSubmit,
            }}
            workbench={
              shouldRenderWorkbench && selectedResponse ? (
                <ThreadWorkbench
                  activeArtifact={activeWorkbenchArtifact}
                  onArtifactChange={setActiveWorkbenchArtifact}
                  onClose={() => setIsWorkbenchOpen(false)}
                  responses={displayThread?.responses || []}
                  selectedResponse={selectedResponse}
                />
              ) : null
            }
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
                await handleCreateSqlPair(
                  data,
                  questionSqlPairModal.state.payload?.responseId,
                );
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
