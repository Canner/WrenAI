import type { ComponentRef, RefObject } from 'react';
import Prompt from '@/components/pages/home/prompt';
import type { RecommendedQuestionsTaskStatus } from '@/types/home';
import type { ThreadResponseData } from './threadPageState';

export type AskPromptRecoveryBridge = {
  data?: {
    askingTask?: unknown;
  } | null;
  loading: boolean;
  onFetching: (queryId: string) => Promise<void>;
  onStopPolling: () => void;
  onStopRecommend: () => void;
  onStopStreaming: () => void;
  onStoreThreadQuestions: (questions: string[]) => void;
};

export type ThreadRecoveryOrchestrationArgs = {
  askPrompt: AskPromptRecoveryBridge;
  fetchThreadResponse: (responseId: number) => Promise<unknown>;
  hasExecutableRuntime: boolean;
  onThreadResponseSettled?: () => void;
  pollingResponse?: ThreadResponseData | null;
  promptRef: RefObject<ComponentRef<typeof Prompt> | null>;
  recommendedQuestionsStatus?: RecommendedQuestionsTaskStatus | null;
  responses: ThreadResponseData[];
  stopThreadRecommendationQuestionsHookPolling: () => void;
  stopThreadResponseHookPolling: () => void;
  threadId?: number | null;
};
