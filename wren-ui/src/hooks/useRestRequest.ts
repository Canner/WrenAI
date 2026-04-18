import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { abortWithReason, isAbortRequestError } from '@/utils/abort';

type RequestContext = {
  signal: AbortSignal;
};

type UseRestRequestOptions<TData, TResult = TData> = {
  enabled?: boolean;
  auto?: boolean;
  initialData: TData;
  requestKey?: string | null;
  request: (context: RequestContext) => Promise<TResult>;
  mapResult?: (result: TResult) => TData;
  onSuccess?: (data: TData, result: TResult) => void;
  onError?: (error: Error) => void;
  resetDataOnDisable?: boolean;
};

type UseRestRequestResult<TData> = {
  data: TData;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<TData>;
  setData: Dispatch<SetStateAction<TData>>;
};

export class RestRequestCoordinator {
  private requestId = 0;
  private abortController: AbortController | null = null;

  public cancel(reason = 'request-cancelled') {
    if (this.abortController) {
      abortWithReason(this.abortController, reason);
    }
    this.abortController = null;
  }

  public begin() {
    this.cancel('superseded-by-new-request');
    const controller = new AbortController();
    const requestId = this.requestId + 1;
    this.requestId = requestId;
    this.abortController = controller;

    return {
      requestId,
      signal: controller.signal,
      isCurrent: () =>
        this.requestId === requestId &&
        this.abortController === controller &&
        !controller.signal.aborted,
      finalize: () => {
        if (this.abortController === controller) {
          this.abortController = null;
        }
      },
    };
  }
}

export const normalizeRestRequestError = (error: unknown) =>
  error instanceof Error ? error : new Error('请求失败，请稍后重试。');

export default function useRestRequest<TData, TResult = TData>({
  enabled = true,
  auto = true,
  initialData,
  requestKey,
  request,
  mapResult,
  onSuccess,
  onError,
  resetDataOnDisable = true,
}: UseRestRequestOptions<TData, TResult>): UseRestRequestResult<TData> {
  const initialDataRef = useRef(initialData);
  initialDataRef.current = initialData;

  const [data, setData] = useState<TData>(initialData);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [loading, setLoading] = useState(Boolean(enabled && auto));
  const [error, setError] = useState<Error | null>(null);
  const requestRef = useRef(request);
  requestRef.current = request;
  const mapResultRef = useRef(mapResult);
  mapResultRef.current = mapResult;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const requestCoordinatorRef = useRef(new RestRequestCoordinator());

  const cancelInFlightRequest = useCallback(() => {
    requestCoordinatorRef.current.cancel();
  }, []);

  const refetch = useCallback(async () => {
    if (!enabled) {
      cancelInFlightRequest();
      if (resetDataOnDisable) {
        setData(initialDataRef.current);
      }
      setError(null);
      setLoading(false);
      return initialDataRef.current;
    }

    const pendingRequest = requestCoordinatorRef.current.begin();
    setLoading(true);

    try {
      const result = await requestRef.current({ signal: pendingRequest.signal });
      const nextData = mapResultRef.current
        ? mapResultRef.current(result)
        : (result as unknown as TData);

      if (pendingRequest.isCurrent()) {
        setData(nextData);
        setError(null);
        onSuccessRef.current?.(nextData, result);
      }

      return nextData;
    } catch (error) {
      if (pendingRequest.signal.aborted || isAbortRequestError(error)) {
        return dataRef.current;
      }

      const normalizedError = normalizeRestRequestError(error);
      if (pendingRequest.isCurrent()) {
        setError(normalizedError);
        onErrorRef.current?.(normalizedError);
      }
      throw normalizedError;
    } finally {
      if (pendingRequest.isCurrent()) {
        setLoading(false);
      }
      pendingRequest.finalize();
    }
  }, [
    cancelInFlightRequest,
    enabled,
    resetDataOnDisable,
  ]);

  useEffect(() => {
    if (!enabled) {
      cancelInFlightRequest();
      if (resetDataOnDisable) {
        setData(initialDataRef.current);
      }
      setError(null);
      setLoading(false);
      return;
    }

    if (!auto) {
      return;
    }

    void refetch().catch((error) => {
      if (isAbortRequestError(error)) {
        return;
      }
    });

    return () => {
      cancelInFlightRequest();
    };
  }, [
    auto,
    cancelInFlightRequest,
    enabled,
    refetch,
    requestKey,
    resetDataOnDisable,
  ]);

  return {
    data,
    loading,
    error,
    refetch,
    setData,
  };
}
