import { message } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildRuntimeScopeUrl } from '@/apollo/client/runtimeScope';

type TextBasedAnswerStreamTaskReturn = [
  (responseId: number) => void,
  {
    data: string;
    loading: boolean;
    onReset: () => void;
  },
];

export default function useTextBasedAnswerStreamTask() {
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
        buildRuntimeScopeUrl('/api/ask_task/streaming_answer', { responseId }),
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
    [onReset],
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
