import { useEffect } from 'react';
import useStoreContext, { STORE } from '@/hooks/useStoreContext';
import {
  AdjustThreadResponseChartInput,
  DetailedThread,
  RecommendedQuestionsTask,
} from '@/apollo/client/graphql/__types__';
import { SelectQuestionProps } from '@/components/pages/home/RecommendedQuestions';

type IPromptThreadStore = {
  data: DetailedThread;
  recommendedQuestions: RecommendedQuestionsTask;
  showRecommendedQuestions: boolean;
  preparation: {
    generateAnswerLoading?: boolean;
  };
  onOpenSaveAsViewModal: (data: { sql: string; responseId: number }) => void;
  onSelectRecommendedQuestion: ({
    question,
    sql,
  }: SelectQuestionProps) => Promise<void>;
  onGenerateThreadRecommendedQuestions: () => Promise<void>;
  onGenerateTextBasedAnswer: (responseId: number) => Promise<void>;
  onGenerateBreakdownAnswer: (responseId: number) => Promise<void>;
  onGenerateChartAnswer: (responseId: number) => Promise<void>;
  onAdjustChartAnswer: (
    responseId: number,
    data: AdjustThreadResponseChartInput,
  ) => Promise<void>;
};

// Register store provider
export const PromptThreadProvider = (props: {
  children: React.ReactNode;
  value: IPromptThreadStore;
}) => {
  const storeContext = useStoreContext();
  const PromptThreadContext = storeContext.createStore(STORE.PROMPT_THREAD);
  // clear store when unmount
  useEffect(() => {
    return () => storeContext.clearStore(STORE.PROMPT_THREAD);
  }, []);
  return (
    <PromptThreadContext.Provider value={props.value}>
      {props.children}
    </PromptThreadContext.Provider>
  );
};

// Use store
export default function usePromptThreadStore() {
  const storeContext = useStoreContext();
  return storeContext.useStore(STORE.PROMPT_THREAD) as IPromptThreadStore;
}
