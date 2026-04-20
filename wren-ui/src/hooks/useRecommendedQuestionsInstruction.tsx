import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { message } from 'antd';
import { hasExecutableRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import Icon from '@/import/icon';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import { CopilotSVG } from '@/utils/svgs';

import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import usePollingRequestLoop from './usePollingRequestLoop';
import {
  generateProjectRecommendationQuestions,
  getProjectRecommendationQuestions,
} from '@/utils/homeRest';
import {
  buildEmptyRecommendedQuestionsTask,
  createRecommendationPollingLoader,
  resolveRecommendedQuestionsSettlement,
  shouldContinueRecommendationPolling,
  type GroupedQuestion,
} from './recommendedQuestionsInstructionHelpers';

export type { GroupedQuestion } from './recommendedQuestionsInstructionHelpers';

const RECOMMENDED_QUESTION_POLL_INTERVAL_MS = 2000;
const RECOMMENDED_QUESTION_POLL_TIMEOUT_MS = 20_000;

export default function useRecommendedQuestionsInstruction(enabled = true) {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingTriggeredByActionRef = useRef(false);
  const [showRetry, setShowRetry] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [isRegenerate, setIsRegenerate] = useState<boolean>(false);
  const [
    showRecommendedQuestionsPromptMode,
    setShowRecommendedQuestionsPromptMode,
  ] = useState<boolean>(false);
  const [recommendedQuestions, setRecommendedQuestions] = useState<
    GroupedQuestion[]
  >([]);

  const clearPollingTimeout = useCallback(() => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);
  const hasExecutableRuntime = hasExecutableRuntimeScopeSelector(
    runtimeScopeNavigation.selector,
  );

  const readRecommendationQuestions = useCallback(async () => {
    if (!hasExecutableRuntime) {
      return buildEmptyRecommendedQuestionsTask();
    }
    return getProjectRecommendationQuestions(runtimeScopeNavigation.selector);
  }, [hasExecutableRuntime, runtimeScopeNavigation.selector]);

  const handleRecommendationTaskSettled = useCallback(
    (task: Awaited<ReturnType<typeof readRecommendationQuestions>>) => {
      const settlement = resolveRecommendedQuestionsSettlement({
        task,
        isRegenerate,
        showRecommendedQuestionsPromptMode,
      });

      clearPollingTimeout();
      if (settlement.nextRecommendedQuestions) {
        setRecommendedQuestions(settlement.nextRecommendedQuestions);
      }
      setShowRetry(settlement.nextShowRetry);
      setIsRegenerate(settlement.nextIsRegenerate);
      setShowRecommendedQuestionsPromptMode(
        settlement.nextShowRecommendedQuestionsPromptMode,
      );
      setGenerating(false);
      pollingTriggeredByActionRef.current = false;

      if (settlement.shouldReportRegenerateFailure) {
        message.error(
          `We couldn't regenerate questions right now. Let's try again later.`,
        );
      }
    },
    [clearPollingTimeout, isRegenerate, showRecommendedQuestionsPromptMode],
  );

  const {
    startPolling: startRecommendationPolling,
    stopPolling: stopRecommendationRequestLoop,
  } = usePollingRequestLoop<
    Awaited<ReturnType<typeof readRecommendationQuestions>>
  >({
    pollInterval: RECOMMENDED_QUESTION_POLL_INTERVAL_MS,
    shouldContinue: shouldContinueRecommendationPolling,
    onCompleted: (task) => {
      if (!shouldContinueRecommendationPolling(task)) {
        handleRecommendationTaskSettled(task);
      }
    },
    onError: (error) => {
      clearPollingTimeout();
      setGenerating(false);
      if (pollingTriggeredByActionRef.current) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '生成推荐问题失败，请稍后重试',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      }
      pollingTriggeredByActionRef.current = false;
    },
  });

  const stopPolling = useCallback(() => {
    pollingTriggeredByActionRef.current = false;
    clearPollingTimeout();
    stopRecommendationRequestLoop();
  }, [clearPollingTimeout, stopRecommendationRequestLoop]);

  const schedulePollingTimeout = useCallback(() => {
    clearPollingTimeout();
    pollTimeoutRef.current = setTimeout(() => {
      stopPolling();
      setGenerating(false);
      setShowRetry(true);
      message.warning('推荐问题生成超时，请稍后重试');
    }, RECOMMENDED_QUESTION_POLL_TIMEOUT_MS);
  }, [clearPollingTimeout, stopPolling]);

  useEffect(() => {
    if (!enabled || !hasExecutableRuntime) {
      stopPolling();
      setGenerating(false);
      setShowRecommendedQuestionsPromptMode(false);
      setRecommendedQuestions([]);
      return;
    }

    let cancelled = false;
    void readRecommendationQuestions()
      .then((task) => {
        if (cancelled) {
          return;
        }

        if (!shouldContinueRecommendationPolling(task)) {
          handleRecommendationTaskSettled(task);
          return;
        }

        schedulePollingTimeout();
        pollingTriggeredByActionRef.current = false;
        void startRecommendationPolling(
          createRecommendationPollingLoader(task, readRecommendationQuestions),
        );
      })
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    handleRecommendationTaskSettled,
    hasExecutableRuntime,
    readRecommendationQuestions,
    schedulePollingTimeout,
    startRecommendationPolling,
  ]);

  const onGetRecommendationQuestions = useCallback(async () => {
    if (!enabled || !hasExecutableRuntime) {
      return;
    }

    setGenerating(true);
    setIsRegenerate(true);
    pollingTriggeredByActionRef.current = true;

    try {
      await generateProjectRecommendationQuestions(
        runtimeScopeNavigation.selector,
      );
      schedulePollingTimeout();
      await startRecommendationPolling(readRecommendationQuestions);
    } catch (error) {
      stopPolling();
      setGenerating(false);
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '生成推荐问题失败，请稍后重试',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    }
  }, [
    enabled,
    hasExecutableRuntime,
    readRecommendationQuestions,
    runtimeScopeNavigation.selector,
    schedulePollingTimeout,
    startRecommendationPolling,
    stopPolling,
  ]);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const buttonProps = useMemo(() => {
    const baseProps = {
      loading: generating,
      onClick: onGetRecommendationQuestions,
    };

    if (showRecommendedQuestionsPromptMode && isRegenerate) {
      return {
        ...baseProps,
        icon: <ReloadOutlined />,
        children: 'Regenerate',
      };
    }

    return {
      ...baseProps,
      icon: showRetry ? (
        <ReloadOutlined />
      ) : (
        <Icon component={CopilotSVG} className="geekblue-6" />
      ),
      children: generating
        ? 'Generating questions'
        : showRetry
          ? 'Retry'
          : 'What could I ask?',
    };
  }, [
    generating,
    isRegenerate,
    onGetRecommendationQuestions,
    showRetry,
    showRecommendedQuestionsPromptMode,
  ]);

  return {
    recommendedQuestions,
    generating,
    showRetry,
    showRecommendedQuestionsPromptMode,
    buttonProps,
  };
}
