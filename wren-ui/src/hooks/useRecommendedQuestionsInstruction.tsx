import { useMemo, useState, useEffect } from 'react';
import { groupBy, map, orderBy } from 'lodash';
import Icon from '@ant-design/icons';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import { CopilotSVG } from '@/utils/svgs';
import { isRecommendedFinished } from '@/hooks/useAskPrompt';
import {
  useGetProjectRecommendationQuestionsLazyQuery,
  useGenerateProjectRecommendationQuestionsMutation,
} from '@/apollo/client/graphql/home.generated';

const getGroupedQuestions = (questions: any[]) => {
  return orderBy(
    map(groupBy(questions, 'category'), (questions, category) => ({
      label: category,
      questions: questions.map((q) => q.question),
    })),
    (group) => group.questions.length,
    'desc', // Sort by the number of questions in descending order
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
    Array<{
      label: string;
      questions: Array<{ question: string; sql: string }>;
    }>
  >([]);

  const [fetchRecommendationQuestions, recommendationQuestionsResult] =
    useGetProjectRecommendationQuestionsLazyQuery({
      pollInterval: 2000,
    });

  const [generateProjectRecommendationQuestions] =
    useGenerateProjectRecommendationQuestionsMutation();

  const recommendedQuestionsTask = useMemo(
    () =>
      recommendationQuestionsResult.data?.getProjectRecommendationQuestions ||
      null,
    [recommendationQuestionsResult.data],
  );

  useEffect(() => {
    const fetchRecommendationQuestionsData = async () => {
      const result = await fetchRecommendationQuestions();
      const data = result.data?.getProjectRecommendationQuestions;

      // for existing projects that do not have to generate recommended questions yet
      if (isRecommendedFinished(data.status)) {
        if (data.questions.length > 0) {
          // for regenerate then leave and go back to the home page
          setRecommendedQuestions(getGroupedQuestions(data.questions));

          setShowRecommendedQuestionsPromptMode(true);
        }
      }
    };

    fetchRecommendationQuestionsData();
  }, []);

  useEffect(() => {
    if (isRecommendedFinished(recommendedQuestionsTask?.status)) {
      recommendationQuestionsResult.stopPolling();

      if (recommendedQuestionsTask.questions.length === 0) {
        isRegenerate && setShowRetry(true);
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
  }, [recommendedQuestionsTask]);

  const onGetRecommendationQuestions = async () => {
    setGenerating(true);
    setIsRegenerate(true);
    try {
      await generateProjectRecommendationQuestions();
      fetchRecommendationQuestions();
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
