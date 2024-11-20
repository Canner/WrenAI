import { useRef, useState } from 'react';

type useAskingStreamTaskReturn = [
  (queryId: string) => void,
  { data: string; loading: boolean; reset: () => void },
];

export default function useAskingStreamTask() {
  const eventSourceRef = useRef<EventSource | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [data, setData] = useState<string>('');

  const reset = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    }
    setData('');
  };

  const fetchAskingStreamingTask = (queryId: string) => {
    setLoading(true);
    reset();

    const eventSource = new EventSource(
      `/api/ask_task/streaming?queryId=${queryId}`,
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
    fetchAskingStreamingTask,
    { data, loading, reset },
  ] as useAskingStreamTaskReturn;
}
