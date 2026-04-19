import { useEffect, useState } from 'react';
import {
  fetchSuggestedQuestions,
  type SuggestedQuestionsPayload,
} from '@/utils/homeRest';
import { type ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';

export default function useHomeSuggestedQuestions({
  hasRuntimeScope,
  hasExecutableAskRuntime,
  askRuntimeSelector,
}: {
  hasRuntimeScope: boolean;
  hasExecutableAskRuntime: boolean;
  askRuntimeSelector: ClientRuntimeScopeSelector;
}) {
  const [suggestedQuestionsData, setSuggestedQuestionsData] =
    useState<SuggestedQuestionsPayload | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!hasRuntimeScope || !hasExecutableAskRuntime) {
      setSuggestedQuestionsData(null);
      return () => {
        cancelled = true;
      };
    }

    void fetchSuggestedQuestions(askRuntimeSelector)
      .then((payload) => {
        if (!cancelled) {
          setSuggestedQuestionsData(payload);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSuggestedQuestionsData(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [askRuntimeSelector, hasExecutableAskRuntime, hasRuntimeScope]);

  return {
    suggestedQuestionsData,
  };
}
