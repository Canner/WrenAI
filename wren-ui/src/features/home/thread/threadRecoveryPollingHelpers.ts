import type { MutableRefObject } from 'react';

export function startThreadResponsePollingIfNeeded({
  fetchThreadResponse,
  pollingResponseIdRef,
  responseId,
  scheduleThreadResponsePollingStop,
  stopThreadResponsePolling,
  threadResponseRequestInFlightRef,
}: {
  fetchThreadResponse: (responseId: number) => Promise<unknown>;
  pollingResponseIdRef: MutableRefObject<number | null>;
  responseId: number;
  scheduleThreadResponsePollingStop: () => void;
  stopThreadResponsePolling: () => void;
  threadResponseRequestInFlightRef: MutableRefObject<number | null>;
}) {
  if (
    pollingResponseIdRef.current === responseId ||
    threadResponseRequestInFlightRef.current === responseId
  ) {
    scheduleThreadResponsePollingStop();
    return;
  }

  pollingResponseIdRef.current = responseId;
  threadResponseRequestInFlightRef.current = responseId;
  stopThreadResponsePolling();
  void fetchThreadResponse(responseId).finally(() => {
    if (threadResponseRequestInFlightRef.current === responseId) {
      threadResponseRequestInFlightRef.current = null;
    }
    scheduleThreadResponsePollingStop();
  });
}

export function settleFinishedThreadResponsePolling({
  onThreadResponseSettled,
  pollingResponseFinished,
  pollingResponseIdRef,
  stopThreadResponsePolling,
  threadResponseRequestInFlightRef,
}: {
  onThreadResponseSettled?: () => void;
  pollingResponseFinished: boolean;
  pollingResponseIdRef: MutableRefObject<number | null>;
  stopThreadResponsePolling: () => void;
  threadResponseRequestInFlightRef: MutableRefObject<number | null>;
}) {
  if (pollingResponseIdRef.current === null || !pollingResponseFinished) {
    return;
  }

  stopThreadResponsePolling();
  pollingResponseIdRef.current = null;
  threadResponseRequestInFlightRef.current = null;
  onThreadResponseSettled?.();
}

export function syncThreadRecommendationPollingState({
  recommendedFinished,
  stopThreadRecommendPolling,
  threadRecommendRequestInFlightRef,
}: {
  recommendedFinished: boolean;
  stopThreadRecommendPolling: () => void;
  threadRecommendRequestInFlightRef: MutableRefObject<boolean>;
}) {
  if (!recommendedFinished) {
    return;
  }

  stopThreadRecommendPolling();
  threadRecommendRequestInFlightRef.current = false;
}
