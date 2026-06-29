import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
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

const RECOMMENDATION_POLL_INTERVAL_MS = 2000;
const RECOMMENDATION_POLL_MAX_INTERVAL_MS = 10000;

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

export default function useRecommendedQuestionsInstruction() {
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
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingSessionRef = useRef(0);
  const pollingRequestRef = useRef<Promise<void> | null>(null);
  const pollingDelayRef = useRef(RECOMMENDATION_POLL_INTERVAL_MS);
  const lastFingerprintRef = useRef<string | null>(null);

  const [fetchRecommendationQuestions, recommendationQuestionsResult] =
    useGetProjectRecommendationQuestionsLazyQuery({
      fetchPolicy: 'network-only',
      nextFetchPolicy: 'network-only',
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

  const stopPolling = useCallback(() => {
    pollingSessionRef.current += 1;
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
    pollingDelayRef.current = RECOMMENDATION_POLL_INTERVAL_MS;
  }, []);

  const startPolling = useCallback(async () => {
    if (pollingRequestRef.current || pollingRef.current) {
      return;
    }

    stopPolling();
    const pollingSessionId = pollingSessionRef.current;

    const run = async () => {
      if (pollingSessionRef.current !== pollingSessionId) return;
      if (pollingRequestRef.current) {
        await pollingRequestRef.current;
        if (pollingSessionRef.current !== pollingSessionId) return;
      }

      let shouldContinuePolling = true;
      try {
        const request = fetchRecommendationQuestions();
        pollingRequestRef.current = request.then(() => undefined);
        const result = await request;
        const task = result.data?.getProjectRecommendationQuestions;
        if (!task || isRecommendedFinished(task.status)) {
          shouldContinuePolling = false;
          stopPolling();
        }
      } catch (error) {
        console.error(error);
      } finally {
        pollingRequestRef.current = null;
        if (
          shouldContinuePolling &&
          pollingSessionRef.current === pollingSessionId
        ) {
          pollingRef.current = setTimeout(run, pollingDelayRef.current);
        }
      }
    };

    await run();
  }, [fetchRecommendationQuestions, stopPolling]);

  useEffect(() => {
    const fetchRecommendationQuestionsData = async () => {
      const result = await fetchRecommendationQuestions();
      const data = result.data?.getProjectRecommendationQuestions;
      if (!data) {
        return;
      }

      if (isRecommendedFinished(data.status)) {
        if (data.questions.length > 0) {
          // for regenerate then leave and go back to the home page
          setRecommendedQuestions(getGroupedQuestions(data.questions));

          setShowRecommendedQuestionsPromptMode(true);
        }
      } else {
        setGenerating(true);
        await startPolling();
      }
    };

    fetchRecommendationQuestionsData();
    return () => stopPolling();
  }, [fetchRecommendationQuestions, startPolling, stopPolling]);

  useEffect(() => {
    if (!recommendedQuestionsTask) {
      return;
    }

    if (isRecommendedFinished(recommendedQuestionsTask?.status)) {
      stopPolling();

      if (recommendedQuestionsTask.questions.length === 0) {
        isRegenerate && setShowRetry(true);

        if (
          showRecommendedQuestionsPromptMode &&
          recommendedQuestionsTask.status ===
            RecommendedQuestionsTaskStatus.FAILED
        ) {
          message.error(
            `We couldn't regenerate questions right now. Let's try again later.`,
          );
        }
      } else {
        setIsRegenerate(true);

        // update to recommendedQuestions
        setRecommendedQuestions(
          getGroupedQuestions(recommendedQuestionsTask.questions),
        );
        setShowRecommendedQuestionsPromptMode(true);
      }

      setGenerating(false);
    }
  }, [
    isRegenerate,
    recommendedQuestionsTask,
    showRecommendedQuestionsPromptMode,
    stopPolling,
  ]);

  useEffect(() => {
    const fingerprint = JSON.stringify({
      status: recommendedQuestionsTask?.status || null,
      count: recommendedQuestionsTask?.questions?.length || 0,
      errorCode: recommendedQuestionsTask?.error?.code || null,
    });

    if (lastFingerprintRef.current === fingerprint) {
      pollingDelayRef.current = Math.min(
        pollingDelayRef.current * 2,
        RECOMMENDATION_POLL_MAX_INTERVAL_MS,
      );
    } else {
      pollingDelayRef.current = RECOMMENDATION_POLL_INTERVAL_MS;
      lastFingerprintRef.current = fingerprint;
    }
  }, [
    recommendedQuestionsTask?.status,
    recommendedQuestionsTask?.questions?.length,
    recommendedQuestionsTask?.error?.code,
  ]);

  const onGetRecommendationQuestions = async () => {
    setGenerating(true);
    setIsRegenerate(true);
    try {
      await generateProjectRecommendationQuestions();
      await startPolling();
    } catch (error) {
      console.error(error);
    }
  };

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
  }, [generating, isRegenerate, showRetry, showRecommendedQuestionsPromptMode]);

  return {
    recommendedQuestions,
    generating,
    showRetry,
    showRecommendedQuestionsPromptMode,
    buttonProps,
  };
}
