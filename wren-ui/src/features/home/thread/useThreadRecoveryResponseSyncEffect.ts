import { useEffect, type MutableRefObject } from 'react';

import type { ThreadResponseData } from './threadPageState';
import { syncThreadQuestionStore } from './threadRecoveryQuestionStoreHelpers';
import type { AskPromptRecoveryBridge } from './threadRecoveryOrchestrationTypes';

type UseThreadRecoveryResponseSyncEffectArgs = {
  askPrompt: AskPromptRecoveryBridge;
  handleUnfinishedTasks: (responses: ThreadResponseData[]) => void;
  hasExecutableRuntime: boolean;
  responses: ThreadResponseData[];
  storedQuestionsSignatureRef: MutableRefObject<string | null>;
};

export default function useThreadRecoveryResponseSyncEffect({
  askPrompt,
  handleUnfinishedTasks,
  hasExecutableRuntime,
  responses,
  storedQuestionsSignatureRef,
}: UseThreadRecoveryResponseSyncEffectArgs) {
  useEffect(() => {
    if (responses.length === 0) {
      return;
    }

    if (hasExecutableRuntime) {
      handleUnfinishedTasks(responses);
    }

    syncThreadQuestionStore({
      askPrompt,
      responses,
      storedQuestionsSignatureRef,
    });
  }, [
    askPrompt,
    handleUnfinishedTasks,
    hasExecutableRuntime,
    responses,
    storedQuestionsSignatureRef,
  ]);
}
