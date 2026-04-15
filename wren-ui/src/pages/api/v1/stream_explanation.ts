import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getLogger } from '@server/utils';
import { toCanonicalPersistedRuntimeIdentityFromScope } from '@server/utils/persistedRuntimeIdentity';

const { wrenAIAdaptor, askingService, runtimeScopeResolver } = components;
const logger = getLogger('API_V1_STREAM_EXPLANATION');

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { queryId } = req.query;
  if (!queryId) {
    res.status(400).json({ error: 'queryId is required' });
    return;
  }

  try {
    const runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
    await askingService.assertAskingTaskScope(
      queryId as string,
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope),
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

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
  } catch (error: unknown) {
    logger.error('Failed to stream explanation', error);
    const message =
      error instanceof Error ? error.message : 'Internal Server Error';
    res.status(500).json({ error: message });
  }
}
