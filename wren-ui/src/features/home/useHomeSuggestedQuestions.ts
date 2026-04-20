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
    let timeoutId: number | null = null;
    let idleCallbackId: number | null = null;

    if (!hasRuntimeScope || !hasExecutableAskRuntime) {
      setSuggestedQuestionsData(null);
      return () => {
        cancelled = true;
      };
    }

    setSuggestedQuestionsData(null);

    const runFetch = () => {
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
    };

    if (
      typeof window !== 'undefined' &&
      typeof window.requestIdleCallback === 'function'
    ) {
      idleCallbackId = window.requestIdleCallback(runFetch, {
        timeout: 1200,
      });
    } else if (typeof window !== 'undefined') {
      timeoutId = window.setTimeout(runFetch, 480);
    } else {
      runFetch();
    }

    return () => {
      cancelled = true;
      if (timeoutId != null && typeof window !== 'undefined') {
        window.clearTimeout(timeoutId);
      }
      if (
        idleCallbackId != null &&
        typeof window !== 'undefined' &&
        typeof window.cancelIdleCallback === 'function'
      ) {
        window.cancelIdleCallback(idleCallbackId);
      }
    };
  }, [askRuntimeSelector, hasExecutableAskRuntime, hasRuntimeScope]);

  return {
    suggestedQuestionsData,
  };
}
