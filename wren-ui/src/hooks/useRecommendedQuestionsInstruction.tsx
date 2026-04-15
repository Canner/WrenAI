import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { groupBy, orderBy, flatMap } from 'lodash';
import { message } from 'antd';
import Icon from '@/import/icon';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import { CopilotSVG } from '@/utils/svgs';
import { isRecommendedFinished } from '@/hooks/useAskPrompt';
import {
  ResultQuestion,
  RecommendedQuestionsTaskStatus,
} from '@/apollo/client/graphql/__types__';
import {
  useGetProjectRecommendationQuestionsLazyQuery,
  useGenerateProjectRecommendationQuestionsMutation,
} from '@/apollo/client/graphql/home.generated';

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
    (item) => groupedData[item.category].length, // Sort by number of questions in each category
    'desc',
  );
};

export default function useRecommendedQuestionsInstruction(enabled = true) {
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const [fetchRecommendationQuestions, recommendationQuestionsResult] =
    useGetProjectRecommendationQuestionsLazyQuery({
      pollInterval: RECOMMENDED_QUESTION_POLL_INTERVAL_MS,
    });

  // Handle errors via try/catch blocks rather than onError callback
  const [generateProjectRecommendationQuestions] =
    useGenerateProjectRecommendationQuestionsMutation();

  const recommendedQuestionsTask = useMemo(
    () =>
      recommendationQuestionsResult.data?.getProjectRecommendationQuestions ||
      null,
    [recommendationQuestionsResult.data],
  );

  const clearPollTimeout = useCallback(() => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const stopPolling = useCallback(() => {
    recommendationQuestionsResult.stopPolling();
    clearPollTimeout();
  }, [clearPollTimeout, recommendationQuestionsResult]);

  const schedulePollingTimeout = useCallback(() => {
    clearPollTimeout();
    pollTimeoutRef.current = setTimeout(() => {
      recommendationQuestionsResult.stopPolling();
      setGenerating(false);
      setShowRetry(true);
      message.warning('推荐问题生成超时，请稍后重试');
    }, RECOMMENDED_QUESTION_POLL_TIMEOUT_MS);
  }, [clearPollTimeout, recommendationQuestionsResult]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const fetchRecommendationQuestionsData = async () => {
      const result = await fetchRecommendationQuestions();
      const data = result.data?.getProjectRecommendationQuestions;
      if (!data) {
        return;
      }

      schedulePollingTimeout();

      // for existing projects that do not have to generate recommended questions yet
      if (isRecommendedFinished(data.status)) {
        stopPolling();
        if (data.questions.length > 0) {
          // for regenerate then leave and go back to the home page
          setRecommendedQuestions(getGroupedQuestions(data.questions));

          setShowRecommendedQuestionsPromptMode(true);
        }
      }
    };

    fetchRecommendationQuestionsData();
  }, [
    enabled,
    fetchRecommendationQuestions,
    schedulePollingTimeout,
    stopPolling,
  ]);

  useEffect(() => {
    const task = recommendedQuestionsTask;
    if (!task || !isRecommendedFinished(task.status)) {
      return;
    }

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

      // update to recommendedQuestions
      setRecommendedQuestions(getGroupedQuestions(task.questions));
      setShowRecommendedQuestionsPromptMode(true);
    }

    setGenerating(false);
  }, [
    isRegenerate,
    recommendedQuestionsTask,
    showRecommendedQuestionsPromptMode,
    stopPolling,
  ]);

  const onGetRecommendationQuestions = useCallback(async () => {
    if (!enabled) {
      return;
    }

    setGenerating(true);
    setIsRegenerate(true);
    try {
      await generateProjectRecommendationQuestions();
      fetchRecommendationQuestions();
      schedulePollingTimeout();
    } catch (error) {
      stopPolling();
      message.error(
        error instanceof Error ? error.message : '生成推荐问题失败，请稍后重试',
      );
    }
  }, [
    enabled,
    fetchRecommendationQuestions,
    generateProjectRecommendationQuestions,
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
