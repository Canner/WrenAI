import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { TextBasedAnswerStatus } from '@/server/models/adaptor';
import { ThreadResponseAnswerStatus } from '@/server/services/askingService';
import { TelemetryEvent } from '@/server/telemetry/telemetry';
import { getLogger } from '@server/utils';
import { toCanonicalPersistedRuntimeIdentityFromScope } from '@server/utils/persistedRuntimeIdentity';
import { collectTextAnswerStreamContent } from '@server/utils/textAnswerStream';

const { wrenAIAdaptor, askingService, telemetry, runtimeScopeResolver } =
  components;
const logger = getLogger('API_ASK_TASK_STREAMING_ANSWER');

const initSseResponse = (res: NextApiResponse) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
};

export const handleThreadResponseStream = async ({
  req,
  res,
  responseId,
}: {
  req: NextApiRequest;
  res: NextApiResponse;
  responseId?: string | string[];
}) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const responseIdValue = Array.isArray(responseId)
    ? responseId[0]
    : responseId;
  if (!responseIdValue) {
    res.status(400).json({ error: 'responseId is required' });
    return;
  }

  initSseResponse(res);

  try {
    const runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const numericResponseId = Number(responseIdValue);

    await askingService.assertResponseScope(numericResponseId, runtimeIdentity);
    const response = await askingService.getResponseScoped(
      numericResponseId,
      runtimeIdentity,
    );
    if (!response) {
      throw new Error(`Thread response ${responseIdValue} not found`);
    }

    if (
      response.answerDetail?.status === ThreadResponseAnswerStatus.FINISHED &&
      response.answerDetail.content
    ) {
      res.write(
        `data: ${JSON.stringify({ message: response.answerDetail.content })}\n\n`,
      );
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    if (
      response.answerDetail?.status !== ThreadResponseAnswerStatus.STREAMING
    ) {
      throw new Error(
        `Thread response ${responseIdValue} is not in streaming status`,
      );
    }

    const queryId = response.answerDetail?.queryId;
    if (!queryId) {
      throw new Error(
        `Thread response ${responseIdValue} does not have queryId`,
      );
    }

    const currentAnswerResult =
      await wrenAIAdaptor.getTextBasedAnswerResult(queryId);
    if (
      currentAnswerResult.status === TextBasedAnswerStatus.SUCCEEDED &&
      typeof currentAnswerResult.content === 'string'
    ) {
      res.write(
        `data: ${JSON.stringify({ message: currentAnswerResult.content })}\n\n`,
      );
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      telemetry.sendEvent(TelemetryEvent.HOME_ANSWER_QUESTION, {
        question: response.question,
      });
      return;
    }

    const stream = await wrenAIAdaptor.streamTextBasedAnswer(queryId);
    let clientClosed = false;
    let streamCompleted = false;

    req.on('close', () => {
      if (streamCompleted) {
        return;
      }
      clientClosed = true;
      stream.destroy();
      telemetry.sendEvent(TelemetryEvent.HOME_ANSWER_QUESTION_INTERRUPTED, {
        question: response.question,
      });
    });

    try {
      await collectTextAnswerStreamContent(stream, {
        onData: (chunk) => {
          if (clientClosed || res.writableEnded) {
            return;
          }
          res.write(chunk);
        },
      });
    } catch (streamError) {
      if (clientClosed) {
        return;
      }
      throw streamError;
    }
    streamCompleted = true;

    if (!clientClosed && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    }
    telemetry.sendEvent(TelemetryEvent.HOME_ANSWER_QUESTION, {
      question: response.question,
    });
  } catch (error) {
    logger.error('Failed to stream answer task', error);
    if (!res.headersSent) {
      res.status(500).end();
      return;
    }
    res.end();
  }
};
