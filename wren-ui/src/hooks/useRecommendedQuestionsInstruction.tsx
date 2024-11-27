import { useMemo, useState, useEffect } from 'react';
import { groupBy, orderBy, flatMap } from 'lodash';
import { message } from 'antd';
import Icon from '@ant-design/icons';
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
