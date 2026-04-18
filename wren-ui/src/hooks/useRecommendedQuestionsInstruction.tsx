import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { groupBy, orderBy, flatMap } from 'lodash';
import { message } from 'antd';
import { hasExecutableRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import Icon from '@/import/icon';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import { CopilotSVG } from '@/utils/svgs';
import { isRecommendedFinished } from '@/hooks/useAskPrompt';
import { ResultQuestion, RecommendedQuestionsTaskStatus } from '@/types/home';

import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import {
  generateProjectRecommendationQuestions,
  getProjectRecommendationQuestions,
} from '@/utils/homeRest';

export interface GroupedQuestion {
  category: string;
  question: string;
  sql: string;
}

const RECOMMENDED_QUESTION_POLL_INTERVAL_MS = 2000;
const RECOMMENDED_QUESTION_POLL_TIMEOUT_MS = 20_000;

const getGroupedQuestions = (
  questions: ResultQuestion[],
): GroupedQuestion[] => {
  const groupedData = groupBy(questions, 'category');
  return orderBy(
    flatMap(groupedData),
    (item) => groupedData[item.category].length,
    'desc',
  );
};

export default function useRecommendedQuestionsInstruction(enabled = true) {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const clearTimers = useCallback(() => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const stopPolling = useCallback(() => {
    clearTimers();
  }, [clearTimers]);
  const hasExecutableRuntime = hasExecutableRuntimeScopeSelector(
    runtimeScopeNavigation.selector,
  );

  const readRecommendationQuestions = useCallback(async () => {
    if (!hasExecutableRuntime) {
      return {
        status: RecommendedQuestionsTaskStatus.FINISHED,
        questions: [],
      };
    }
    return getProjectRecommendationQuestions(runtimeScopeNavigation.selector);
  }, [hasExecutableRuntime, runtimeScopeNavigation.selector]);

  const pollRecommendationQuestions = useCallback(async () => {
    const task = await readRecommendationQuestions();

    if (isRecommendedFinished(task.status)) {
      stopPolling();

      if (task.questions.length === 0) {
        isRegenerate && setShowRetry(true);

        if (
          showRecommendedQuestionsPromptMode &&
          task.status === RecommendedQuestionsTaskStatus.FAILED
        ) {
          message.error(
            `We couldn't regenerate questions right now. Let's try again later.`,
          );
        }
      } else {
        setIsRegenerate(true);
        setRecommendedQuestions(getGroupedQuestions(task.questions));
        setShowRecommendedQuestionsPromptMode(true);
      }

      setGenerating(false);
      return task;
    }

    pollTimerRef.current = setTimeout(() => {
      void pollRecommendationQuestions().catch(() => null);
    }, RECOMMENDED_QUESTION_POLL_INTERVAL_MS);

    return task;
  }, [
    isRegenerate,
    readRecommendationQuestions,
    showRecommendedQuestionsPromptMode,
    stopPolling,
  ]);

  const schedulePollingTimeout = useCallback(() => {
    clearTimers();
    pollTimeoutRef.current = setTimeout(() => {
      stopPolling();
      setGenerating(false);
      setShowRetry(true);
      message.warning('推荐问题生成超时，请稍后重试');
    }, RECOMMENDED_QUESTION_POLL_TIMEOUT_MS);
  }, [clearTimers, stopPolling]);

  useEffect(() => {
    if (!enabled || !hasExecutableRuntime) {
      clearTimers();
      setGenerating(false);
      setShowRecommendedQuestionsPromptMode(false);
      setRecommendedQuestions([]);
      return;
    }

    void readRecommendationQuestions()
      .then((task) => {
        schedulePollingTimeout();
        if (isRecommendedFinished(task.status)) {
          stopPolling();
          if (task.questions.length > 0) {
            setRecommendedQuestions(getGroupedQuestions(task.questions));
            setShowRecommendedQuestionsPromptMode(true);
          }
          return;
        }

        pollTimerRef.current = setTimeout(() => {
          void pollRecommendationQuestions().catch(() => null);
        }, RECOMMENDED_QUESTION_POLL_INTERVAL_MS);
      })
      .catch(() => null);
  }, [
    enabled,
    hasExecutableRuntime,
    pollRecommendationQuestions,
    readRecommendationQuestions,
    schedulePollingTimeout,
    stopPolling,
  ]);

  const onGetRecommendationQuestions = useCallback(async () => {
    if (!enabled || !hasExecutableRuntime) {
      return;
    }

    setGenerating(true);
    setIsRegenerate(true);

    try {
      await generateProjectRecommendationQuestions(
        runtimeScopeNavigation.selector,
      );
      schedulePollingTimeout();
      await pollRecommendationQuestions();
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
    pollRecommendationQuestions,
    runtimeScopeNavigation.selector,
    schedulePollingTimeout,
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
