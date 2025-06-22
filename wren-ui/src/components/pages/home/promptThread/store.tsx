import { useEffect } from 'react';
import useStoreContext, { STORE } from '@/hooks/useStoreContext';
import {
  AdjustThreadResponseChartInput,
  DetailedThread,
  RecommendedQuestionsTask,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';
import { SelectQuestionProps } from '@/components/pages/home/RecommendedQuestions';

export type IPromptThreadStore = {
  data: DetailedThread;
  recommendedQuestions: RecommendedQuestionsTask;
  showRecommendedQuestions: boolean;
  preparation: {
    askingStreamTask?: string;
    onStopAskingTask?: (queryId?: string) => Promise<void>;
    onStopAdjustTask?: (queryId?: string) => Promise<void>;
    onReRunAskingTask?: (threadResponse: ThreadResponse) => Promise<void>;
    onReRunAdjustTask?: (threadResponse: ThreadResponse) => Promise<void>;
    onFixSQLStatement?: (responseId: number, sql: string) => Promise<void>;
    fixStatementLoading?: boolean;
  };
  onOpenSaveAsViewModal: (data: { sql: string; responseId: number }) => void;
  onSelectRecommendedQuestion: ({
    question,
    sql,
  }: SelectQuestionProps) => Promise<void>;
  onGenerateThreadRecommendedQuestions: () => Promise<void>;
  onGenerateTextBasedAnswer: (responseId: number) => Promise<void>;
  onGenerateChartAnswer: (responseId: number) => Promise<void>;
  onAdjustChartAnswer: (
    responseId: number,
    data: AdjustThreadResponseChartInput,
  ) => Promise<void>;
  onOpenSaveToKnowledgeModal: (
    data: { sql: string; question: string },
    payload: { isCreateMode: boolean },
  ) => void;
  onOpenAdjustReasoningStepsModal: (data: {
    responseId: number;
    retrievedTables: string[];
    sqlGenerationReasoning: string;
  }) => void;
  onOpenAdjustSQLModal: (data: { responseId: number; sql: string }) => void;
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
