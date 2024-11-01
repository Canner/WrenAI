import { Button } from 'antd';
import EventSource from 'eventsource';
import { Suspense, useEffect, useState } from 'react';

function createSSEDataFetcher(url, setData) {
  let data = null;

  const eventSource = new EventSource(url);

  // Listen for SSE messages and resolve the promise each time a new message arrives
  eventSource.onmessage = (event) => {
    data = JSON.parse(event.data);
    setData && setData(data);
    if (data.action === 'end') {
      eventSource.close();
    }
  };

  return {
    close() {
      eventSource.close();
    },
  };
}

function SSEContent({ data }) {
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (data) setMessage(message + data.message);
    return () => {
      setMessage('');
    };
  }, [data]);

  if (data === null) return;

  return (
    <div>
      <h2>Server-Sent Event Data</h2>
      <p>{message}</p>
      <p>Time: {data.time}</p>
    </div>
  );
}

export default function Test() {
  const [data, setData] = useState(null);

  // useEffect(() => {
  //   const dataFetcher = createSSEDataFetcher(
  //     'http://localhost:3000/api/stream',
  //     setData,
  //   );
  //   return () => {
  //     dataFetcher.close(); // Close SSE connection when component unmounts
  //   };
  // }, []);

  const onClick = () => {
    createSSEDataFetcher('http://localhost:3000/api/stream', setData);
  };

  return (
    <div className="p-5">
      <h1>Streaming Test</h1>
      <Suspense fallback={<div>Loading...</div>}>
        <SSEContent data={data} />
      </Suspense>
      <Button onClick={onClick}>Test</Button>
    </div>
  );
}
