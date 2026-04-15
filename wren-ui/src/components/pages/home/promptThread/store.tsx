import { createContext, useContext } from 'react';
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
  onOpenSaveAsViewModal: (
    data: { sql: string; responseId: number },
    payload: { rephrasedQuestion: string },
  ) => void;
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

const PromptThreadContext = createContext<IPromptThreadStore | null>(null);

export const PromptThreadProvider = (props: {
  children: React.ReactNode;
  value: IPromptThreadStore;
}) => (
  <PromptThreadContext.Provider value={props.value}>
    {props.children}
  </PromptThreadContext.Provider>
);

export default function usePromptThreadStore() {
  const store = useContext(PromptThreadContext);

  if (!store) {
    throw new Error('PromptThreadProvider is missing');
  }

  return store;
}
