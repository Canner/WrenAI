import { useCallback, useEffect, useRef, useState } from 'react';

export type PollingRequestLoader<TData> = () => Promise<TData>;

type UsePollingRequestLoopOptions<TData> = {
  pollInterval?: number;
  onCompleted?: (data: TData) => void;
  onError?: (error: Error) => void;
  shouldContinue?: (data: TData) => boolean;
};

type UsePollingRequestLoopResult<TData> = {
  data: TData | null;
  loading: boolean;
  startPolling: (loader: PollingRequestLoader<TData>) => Promise<TData | null>;
  stopPolling: () => void;
};

export const normalizePollingRequestError = (error: unknown) =>
  error instanceof Error ? error : new Error('请求失败，请稍后重试');

export class PollingRequestCoordinator {
  private sessionId = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  public stop() {
    this.sessionId += 1;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public begin() {
    this.stop();
    const sessionId = this.sessionId;

    return {
      isCurrent: () => this.sessionId === sessionId,
      scheduleNext: (callback: () => void, intervalMs: number) => {
        if (this.sessionId !== sessionId) {
          return;
        }

        this.timer = setTimeout(() => {
          if (this.sessionId === sessionId) {
            callback();
          }
        }, intervalMs);
      },
    };
  }
}

export default function usePollingRequestLoop<TData>({
  pollInterval = 1500,
  onCompleted,
  onError,
  shouldContinue,
}: UsePollingRequestLoopOptions<TData>): UsePollingRequestLoopResult<TData> {
  const [data, setData] = useState<TData | null>(null);
  const [loading, setLoading] = useState(false);
  const coordinatorRef = useRef(new PollingRequestCoordinator());

  const stopPolling = useCallback(() => {
    coordinatorRef.current.stop();
  }, []);

  const startPolling = useCallback(
    async (loader: PollingRequestLoader<TData>) => {
      const pollingSession = coordinatorRef.current.begin();
      setLoading(true);

      const run = async (): Promise<TData | null> => {
        try {
          const nextData = await loader();

          if (!pollingSession.isCurrent()) {
            return nextData;
          }

          setData(nextData);
          onCompleted?.(nextData);
          if (shouldContinue ? shouldContinue(nextData) : true) {
            pollingSession.scheduleNext(() => {
              void run();
            }, pollInterval);
          }
          return nextData;
        } catch (error) {
          if (pollingSession.isCurrent()) {
            onError?.(normalizePollingRequestError(error));
          }
          return null;
        } finally {
          if (pollingSession.isCurrent()) {
            setLoading(false);
          }
        }
      };

      return run();
    },
    [onCompleted, onError, pollInterval, shouldContinue],
  );

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    data,
    loading,
    startPolling,
    stopPolling,
  };
}
