import { useMemo, useState, useEffect } from 'react';
import { groupBy, map, orderBy } from 'lodash';
import Icon from '@ant-design/icons';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import { CopilotSVG } from '@/utils/svgs';
import { isRecommendedFinished } from '@/hooks/useAskPrompt';
import { useGetProjectRecommendationQuestionsLazyQuery } from '@/apollo/client/graphql/home.generated';

export default function useRecommendedQuestionsInstruction() {
  const [showRetry, setShowRetry] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [isRegenerate, setIsRegenerate] = useState<boolean>(false);

  const [fetchRecommendationQuestions, recommendationQuestionsResult] =
    useGetProjectRecommendationQuestionsLazyQuery({
      pollInterval: 2000,
    });

  const recommendedQuestionsTask = useMemo(
    () =>
      recommendationQuestionsResult.data?.getProjectRecommendationQuestions ||
      null,
    [recommendationQuestionsResult.data],
  );

  useEffect(() => {
    fetchRecommendationQuestions();
  }, []);

  useEffect(() => {
    if (isRecommendedFinished(recommendedQuestionsTask?.status)) {
      recommendationQuestionsResult.stopPolling();

      if (recommendedQuestionsTask.questions.length === 0) {
        isRegenerate && setShowRetry(true);
      } else {
        setIsRegenerate(true);
      }

      setGenerating(false);
    }
  }, [recommendedQuestionsTask]);

  const recommendedQuestions = useMemo(() => {
    if (!recommendedQuestionsTask?.questions) return [];

    return orderBy(
      map(
        groupBy(recommendedQuestionsTask.questions, 'category'),
        (questions, category) => ({
          label: category,
          questions: questions.map((q) => q.question),
        }),
      ),
      (group) => group.questions.length,
      'desc', // Sort by the number of questions in descending order
    );
  }, [recommendedQuestionsTask]);

  const onGetRecommendationQuestions = async () => {
    setGenerating(true);
    setIsRegenerate(true);
    try {
      // TOD: step1: trigger generate recommended questions
      // TOD: step2: fetch recommended questions
    } catch (error) {
      console.error(error);
    }
  };

  const buttonProps = useMemo(() => {
    const baseProps = {
      loading: generating,
      onClick: onGetRecommendationQuestions,
    };

    if (isRegenerate) {
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
  }, [generating, isRegenerate, showRetry]);

  return {
    recommendedQuestions,
    generating,
    showRetry,
    buttonProps,
  };
}
