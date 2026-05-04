import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';

const { wrenAIAdaptor } = components;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const { queryId } = req.query;
  try {
    const stream = await wrenAIAdaptor.getAskStreamingResult(queryId as string);

    stream.on('data', (chunk) => {
      // pass the chunk directly to the client
      res.write(chunk);
    });

    stream.on('end', () => {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    });

    // destroy the stream if the client closes the connection
    req.on('close', () => {
      stream.destroy();
    });
  } catch (error) {
    console.error(error);
    res.status(500).end();
  }
}
