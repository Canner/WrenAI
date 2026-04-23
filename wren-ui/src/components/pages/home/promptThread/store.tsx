import { createContext, useContext } from 'react';
import type {
  AdjustThreadResponseChartInput,
  DetailedThread,
  RecommendedQuestionsTask,
  ThreadResponse,
} from '@/types/home';
import type { ComposerDraftIntent } from '@/types/homeIntent';
import type { WorkbenchArtifactKind } from '@/features/home/thread/threadWorkbenchState';

import { SelectQuestionProps } from '@/components/pages/home/RecommendedQuestions';

export type IPromptThreadStore = {
  data: DetailedThread;
  recommendedQuestions: RecommendedQuestionsTask | null;
  recommendedQuestionsOwnerResponseId?: number | null;
  selectedResponseId?: number | null;
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
  onDraftConversationAid: (payload: {
    intentHint: ComposerDraftIntent['intentHint'];
    prompt: string;
    sourceAidKind?: ComposerDraftIntent['sourceAidKind'];
    sourceResponseId?: number | null;
  }) => void;
  onGenerateThreadRecommendedQuestions: () => Promise<void>;
  onGenerateTextBasedAnswer: (responseId: number) => Promise<void>;
  onGenerateChartAnswer: (
    responseId: number,
    options?: {
      question?: string;
      sourceResponseId?: number;
    },
  ) => Promise<void>;
  onAdjustChartAnswer: (
    responseId: number,
    data: AdjustThreadResponseChartInput,
  ) => Promise<void>;
  onSelectResponse: (
    responseId: number,
    options?: {
      artifact?: WorkbenchArtifactKind | null;
      openWorkbench?: boolean;
      userInitiated?: boolean;
    },
  ) => void;
  onOpenSaveToKnowledgeModal: (
    data: { sql: string; question: string },
    payload: { isCreateMode: boolean; responseId?: number },
  ) => void;
  onOpenAdjustReasoningStepsModal: (data: {
    responseId: number;
    retrievedTables: string[];
    sqlGenerationReasoning: string;
  }) => void;
  onOpenAdjustSQLModal: (data: { responseId: number; sql: string }) => void;
};

type PromptThreadDataStore = Pick<
  IPromptThreadStore,
  | 'data'
  | 'recommendedQuestions'
  | 'recommendedQuestionsOwnerResponseId'
  | 'selectedResponseId'
  | 'showRecommendedQuestions'
>;

type PromptThreadPreparationStore = Pick<IPromptThreadStore, 'preparation'>;

type PromptThreadActionsStore = Omit<
  IPromptThreadStore,
  'data' | 'recommendedQuestions' | 'showRecommendedQuestions' | 'preparation'
>;

const PromptThreadDataContext = createContext<PromptThreadDataStore | null>(
  null,
);
const PromptThreadPreparationContext =
  createContext<PromptThreadPreparationStore | null>(null);
const PromptThreadActionsContext =
  createContext<PromptThreadActionsStore | null>(null);

export const PromptThreadProvider = (props: {
  children: React.ReactNode;
  dataValue: PromptThreadDataStore;
  preparationValue: PromptThreadPreparationStore;
  actionsValue: PromptThreadActionsStore;
}) => (
  <PromptThreadDataContext.Provider value={props.dataValue}>
    <PromptThreadPreparationContext.Provider value={props.preparationValue}>
      <PromptThreadActionsContext.Provider value={props.actionsValue}>
        {props.children}
      </PromptThreadActionsContext.Provider>
    </PromptThreadPreparationContext.Provider>
  </PromptThreadDataContext.Provider>
);

export default function usePromptThreadStore() {
  const dataStore = useContext(PromptThreadDataContext);
  const preparationStore = useContext(PromptThreadPreparationContext);
  const actionsStore = useContext(PromptThreadActionsContext);

  if (!dataStore || !preparationStore || !actionsStore) {
    throw new Error('PromptThreadProvider is missing');
  }

  return {
    ...dataStore,
    ...preparationStore,
    ...actionsStore,
  };
}

export function usePromptThreadDataStore() {
  const store = useContext(PromptThreadDataContext);

  if (!store) {
    throw new Error('PromptThreadProvider is missing');
  }

  return store;
}

export function usePromptThreadPreparationStore() {
  const store = useContext(PromptThreadPreparationContext);

  if (!store) {
    throw new Error('PromptThreadProvider is missing');
  }

  return store;
}

export function usePromptThreadActionsStore() {
  const store = useContext(PromptThreadActionsContext);

  if (!store) {
    throw new Error('PromptThreadProvider is missing');
  }

  return store;
}
