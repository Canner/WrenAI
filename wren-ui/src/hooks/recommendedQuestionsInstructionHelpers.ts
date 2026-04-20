import { flatMap, groupBy, orderBy } from 'lodash';
import { isRecommendedFinished } from '@/hooks/useAskPrompt';
import {
  RecommendedQuestionsTaskStatus,
  type RecommendedQuestionsTask,
  type ResultQuestion,
} from '@/types/home';

export interface GroupedQuestion {
  category: string;
  question: string;
  sql: string;
}

export const buildEmptyRecommendedQuestionsTask =
  (): RecommendedQuestionsTask => ({
    status: RecommendedQuestionsTaskStatus.FINISHED,
    questions: [],
  });

export const getGroupedQuestions = (
  questions: ResultQuestion[],
): GroupedQuestion[] => {
  const groupedData = groupBy(questions, 'category');
  return orderBy(
    flatMap(groupedData),
    (item) => groupedData[item.category].length,
    'desc',
  );
};

export const shouldContinueRecommendationPolling = (
  task: RecommendedQuestionsTask,
) => !isRecommendedFinished(task.status);

export const createRecommendationPollingLoader = (
  initialTask: RecommendedQuestionsTask,
  loadTask: () => Promise<RecommendedQuestionsTask>,
) => {
  let isFirstCall = true;

  return async () => {
    if (isFirstCall) {
      isFirstCall = false;
      return initialTask;
    }

    return loadTask();
  };
};

export const resolveRecommendedQuestionsSettlement = ({
  task,
  isRegenerate,
  showRecommendedQuestionsPromptMode,
}: {
  task: RecommendedQuestionsTask;
  isRegenerate: boolean;
  showRecommendedQuestionsPromptMode: boolean;
}) => ({
  nextRecommendedQuestions:
    task.questions.length > 0 ? getGroupedQuestions(task.questions) : null,
  nextShowRetry: task.questions.length === 0 ? isRegenerate : false,
  nextShowRecommendedQuestionsPromptMode:
    task.questions.length > 0 ? true : showRecommendedQuestionsPromptMode,
  nextIsRegenerate: task.questions.length > 0 ? true : isRegenerate,
  shouldReportRegenerateFailure:
    task.questions.length === 0 &&
    showRecommendedQuestionsPromptMode &&
    task.status === RecommendedQuestionsTaskStatus.FAILED,
});
