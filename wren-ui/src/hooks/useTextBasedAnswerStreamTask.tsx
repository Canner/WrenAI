import { useRef, useState } from 'react';

type TextBasedAnswerStreamTaskReturn = [
  (queryId: string) => void,
  {
    data: string;
    loading: boolean;
    onReset: () => void;
  },
];

/**
 * TODO:
 * 1. call /sql-answers API with polling way to obtain the result and status, when the status is preprocessing,
 *    trigger fetchAnswerStreamingTask function to get streaming data.
 */
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

  const fetchAnswerStreamingTask = (responseId: string) => {
    setLoading(true);
    onReset();

    const eventSource = new EventSource(
      `/api/ask_task/streaming_answer?responseId=${responseId}`,
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
