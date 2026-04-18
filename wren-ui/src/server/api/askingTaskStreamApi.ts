import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getLogger } from '@server/utils';
import { toCanonicalPersistedRuntimeIdentityFromScope } from '@server/utils/persistedRuntimeIdentity';

const { wrenAIAdaptor, askingService, runtimeScopeResolver } = components;
const logger = getLogger('API_ASK_TASK_STREAMING');

const initSseResponse = (res: NextApiResponse) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
};

export const handleAskingTaskStream = async ({
  req,
  res,
  queryId,
}: {
  req: NextApiRequest;
  res: NextApiResponse;
  queryId?: string | string[];
}) => {
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const taskId = Array.isArray(queryId) ? queryId[0] : queryId;
  if (!taskId) {
    res.status(400).json({ error: 'queryId is required' });
    return;
  }

  initSseResponse(res);

  try {
    const runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
    await askingService.assertAskingTaskScope(
      taskId,
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope),
    );
    const stream = await wrenAIAdaptor.getAskStreamingResult(taskId);

    stream.on('data', (chunk) => {
      res.write(chunk);
    });

    stream.on('end', () => {
      if (res.writableEnded) {
        return;
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    });

    stream.on('error', (error) => {
      logger.error('Failed during asking task stream', error);
      if (!res.writableEnded) {
        res.end();
      }
    });

    req.on('close', () => {
      stream.destroy();
    });
  } catch (error) {
    logger.error('Failed to stream asking task', error);
    if (!res.headersSent) {
      res.status(500).end();
      return;
    }
    res.end();
  }
};
