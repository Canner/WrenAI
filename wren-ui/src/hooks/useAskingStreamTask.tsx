import { message } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildRuntimeScopeUrl } from '@/apollo/client/runtimeScope';

type useAskingStreamTaskReturn = [
  (queryId: string) => void,
  { data: string; loading: boolean; reset: () => void },
];

export default function useAskingStreamTask() {
  const eventSourceRef = useRef<EventSource | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [data, setData] = useState<string>('');

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
        buildRuntimeScopeUrl('/api/ask_task/streaming', { queryId }),
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
    [reset],
  );

  useEffect(() => {
    return () => {
      closeEventSource();
    };
  }, [closeEventSource]);

  return [
    fetchAskingStreamingTask,
    { data, loading, reset },
  ] as useAskingStreamTaskReturn;
}
