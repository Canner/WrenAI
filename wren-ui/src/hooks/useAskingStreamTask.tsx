import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appMessage as message } from '@/utils/antdAppBridge';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import { buildAskingTaskStreamUrl } from '@/utils/homeRest';

type UseAskingStreamTaskReturn = [
  (queryId: string) => void,
  { data: string; loading: boolean; reset: () => void },
];

export default function useAskingStreamTask(
  selectorOverride?: ClientRuntimeScopeSelector,
) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [data, setData] = useState<string>('');
  const runtimeScopeNavigation = useRuntimeScopeNavigation();

  const selector = useMemo(
    () => selectorOverride || runtimeScopeNavigation.selector,
    [
      runtimeScopeNavigation.selector.deployHash,
      runtimeScopeNavigation.selector.kbSnapshotId,
      runtimeScopeNavigation.selector.knowledgeBaseId,
      runtimeScopeNavigation.selector.runtimeScopeId,
      runtimeScopeNavigation.selector.workspaceId,
      selectorOverride,
    ],
  );

  const closeEventSource = useCallback(() => {
    if (!eventSourceRef.current) {
      return;
    }

    eventSourceRef.current.close();
    eventSourceRef.current = null;
  }, []);

  const reset = useCallback(() => {
    closeEventSource();
    setData('');
    setLoading(false);
  }, [closeEventSource]);

  const fetchAskingStreamingTask = useCallback(
    (queryId: string) => {
      reset();
      setLoading(true);

      const eventSource = new EventSource(
        buildAskingTaskStreamUrl(queryId, selector),
      );
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        let eventData: { done?: boolean; message?: string };
        try {
          eventData = JSON.parse(event.data);
        } catch (_error) {
          message.error('流式结果解析失败，请重试');
          reset();
          return;
        }

        if (eventData.done) {
          reset();
        } else {
          setData((state) => state + (eventData?.message || ''));
        }
      };

      eventSource.onerror = () => {
        message.error('流式连接已中断，请重试');
        reset();
      };
    },
    [reset, selector],
  );

  useEffect(() => {
    return () => {
      closeEventSource();
    };
  }, [closeEventSource]);

  return [
    fetchAskingStreamingTask,
    { data, loading, reset },
  ] as UseAskingStreamTaskReturn;
}
