import type { MutableRefObject } from 'react';

import {
  buildThreadQuestionSignature,
  type ThreadResponseData,
} from './threadPageState';
import type { AskPromptRecoveryBridge } from './threadRecoveryOrchestrationTypes';

export function syncThreadQuestionStore({
  askPrompt,
  responses,
  storedQuestionsSignatureRef,
}: {
  askPrompt: AskPromptRecoveryBridge;
  responses: ThreadResponseData[];
  storedQuestionsSignatureRef: MutableRefObject<string | null>;
}) {
  const nextQuestionsSignature = buildThreadQuestionSignature(responses);
  if (storedQuestionsSignatureRef.current === nextQuestionsSignature) {
    return;
  }

  storedQuestionsSignatureRef.current = nextQuestionsSignature;
  const questions = responses.flatMap((response) => response.question || []);
  if (questions.length > 0) {
    askPrompt.onStoreThreadQuestions(questions);
  }
}
