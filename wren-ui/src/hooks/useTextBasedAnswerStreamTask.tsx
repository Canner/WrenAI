import { useRef, useState } from 'react';
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

  const onReset = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    }
    setData('');
  };

  const fetchAnswerStreamingTask = (responseId: number) => {
    setLoading(true);
    onReset();

    const eventSource = new EventSource(
      buildRuntimeScopeUrl('/api/ask_task/streaming_answer', { responseId }),
    );

    eventSource.onmessage = (event) => {
      const eventData = JSON.parse(event.data);
      if (eventData.done) {
        eventSource.close();
        setLoading(false);
      } else {
        setData((state) => state + (eventData?.message || ''));
      }
    };

    eventSource.onerror = (error) => {
      console.error(error);
      eventSource.close();
      setLoading(false);
    };

    eventSourceRef.current = eventSource;
  };

  return [
    fetchAnswerStreamingTask,
    { data, loading, onReset },
  ] as TextBasedAnswerStreamTaskReturn;
}
