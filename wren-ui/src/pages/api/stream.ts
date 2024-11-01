const text = `
Without these headers, intermediate caches or proxies might attempt to optimize, compress, or delay parts of the response, which interrupts the real-time data flow and prevents the SSE connection from functioning as expected.`;

// pages/api/sse.js
export default async function handler(req, res) {
  // Set headers to enable SSE
  res.setHeader('Content-Type', 'text/event-stream;charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const splitText = text.split(' ');

  // Set up an interval to send events every 2 seconds
  const intervalId = setInterval(() => {
    if (!splitText.length) {
      res.write(
        `data: ${JSON.stringify({ action: 'end', message: '', time: new Date().toLocaleTimeString() })}\n\n`,
      );
      return;
    }
    console.log('send event');

    const eventData = {
      time: new Date().toLocaleTimeString(),
      message: splitText.shift() + ' ',
    };
    res.write(`data: ${JSON.stringify(eventData)}\n\n`);
  }, 100);

  // Clean up when the client disconnects
  req.on('close', () => {
    console.log('close');
    clearInterval(intervalId);
    res.status(200).end();
  });
}
