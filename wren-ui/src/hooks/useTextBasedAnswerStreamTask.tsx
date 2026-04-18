import { message } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import { buildThreadResponseAnswerStreamUrl } from '@/utils/threadRest';

type TextBasedAnswerStreamTaskReturn = [
  (responseId: number) => void,
  {
    data: string;
    loading: boolean;
    onReset: () => void;
  },
];

export default function useTextBasedAnswerStreamTask(
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

  const onReset = useCallback(() => {
    closeEventSource();
    setData('');
    setLoading(false);
  }, [closeEventSource]);

  const fetchAnswerStreamingTask = useCallback(
    (responseId: number) => {
      onReset();
      setLoading(true);

      const eventSource = new EventSource(
        buildThreadResponseAnswerStreamUrl(responseId, selector),
      );
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        let eventData: { done?: boolean; message?: string };
        try {
          eventData = JSON.parse(event.data);
        } catch (_error) {
          message.error('回答流解析失败，请重试');
          onReset();
          return;
        }

        if (eventData.done) {
          onReset();
        } else {
          setData((state) => state + (eventData?.message || ''));
        }
      };

      eventSource.onerror = () => {
        message.error('回答流连接中断，请重试');
        onReset();
      };
    },
    [onReset, selector],
  );

  useEffect(() => {
    return () => {
      closeEventSource();
    };
  }, [closeEventSource]);

  return [
    fetchAnswerStreamingTask,
    { data, loading, onReset },
  ] as TextBasedAnswerStreamTaskReturn;
}
