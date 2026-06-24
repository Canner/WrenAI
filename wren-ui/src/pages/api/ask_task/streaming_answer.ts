import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ThreadResponseAnswerStatus } from '@/apollo/server/services/askingService';
import { TelemetryEvent } from '@/apollo/server/telemetry/telemetry';

const { wrenAIAdaptor, askingService, telemetry } = components;

class ContentMap {
  private contentMap: { [key: string]: string } = {};

  // Method to append (concatenate) content to the map
  public appendContent(key: string, content: string) {
    if (!this.contentMap[key]) {
      this.contentMap[key] = '';
    }
    this.contentMap[key] += content;
  }

  // Method to get content from the map
  public getContent(key: string): string | undefined {
    return this.contentMap[key];
  }

  // Method to remove content from the map
  public remove(key: string) {
    delete this.contentMap[key];
  }
}

const contentMap = new ContentMap();

const parseSSEMessages = (chunk: Buffer): string[] => {
  return chunk
    .toString('utf-8')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length).trim())
    .filter(Boolean)
    .flatMap((payload) => {
      try {
        const eventData = JSON.parse(payload);
        return eventData?.message ? [String(eventData.message)] : [];
      } catch (error) {
        console.error(`Failed to parse streaming answer payload: ${payload}`);
        return [];
      }
    });
};

const buildFallbackAnswer = (question: string) =>
  [
    `I found results for: **${question}**.`,
    '',
    'The result table below contains the data returned from the active datasource. Use the visible fields and rows to review the detailed records, and switch to the chart tab when a visualization is available.',
  ].join('\n');

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const { responseId } = req.query;
  if (!responseId) {
    res.status(400).json({ error: 'responseId is required' });
    return;
  }
  try {
    const response = await askingService.getResponse(Number(responseId));
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }

    // check response status
    if (
      response.answerDetail?.status !== ThreadResponseAnswerStatus.STREAMING
    ) {
      throw new Error(
        `Thread response ${responseId} is not in streaming status`,
      );
    }

    const queryId = response.answerDetail?.queryId;
    if (!queryId) {
      throw new Error(`Thread response ${responseId} does not have queryId`);
    }

    const stream = await wrenAIAdaptor.streamTextBasedAnswer(queryId);
    let streamEnded = false;

    stream.on('data', (chunk) => {
      for (const message of parseSSEMessages(chunk)) {
        contentMap.appendContent(queryId, message);
      }
      res.write(chunk);
    });

    stream.on('end', () => {
      streamEnded = true;
      const finalContent =
        contentMap.getContent(queryId)?.trim() || buildFallbackAnswer(response.question);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      askingService
        .changeThreadResponseAnswerDetailStatus(
          Number(responseId),
          ThreadResponseAnswerStatus.FINISHED,
          finalContent,
        )
        .then(() => {
          console.log(
            'Thread response answer detail status updated to FINISHED',
          );
          contentMap.remove(queryId);
          telemetry.sendEvent(TelemetryEvent.HOME_ANSWER_QUESTION, {
            question: response.question,
          });
        })
        .catch((error) => {
          console.error(
            'Failed to update thread response answer detail status',
            error,
          );
          contentMap.remove(queryId);
          telemetry.sendEvent(
            TelemetryEvent.HOME_ANSWER_QUESTION,
            {
              question: response.question,
              error: error,
            },
            null,
            false,
          );
        });
    });

    // destroy the stream if the client closes the connection
    req.on('close', () => {
      if (streamEnded) {
        return;
      }
      stream.destroy();
      askingService
        .changeThreadResponseAnswerDetailStatus(
          Number(responseId),
          ThreadResponseAnswerStatus.INTERRUPTED,
          contentMap.getContent(queryId),
        )
        .then(() => {
          console.log(
            'Thread response answer detail status updated to INTERRUPTED',
          );
          contentMap.remove(queryId);
          telemetry.sendEvent(TelemetryEvent.HOME_ANSWER_QUESTION_INTERRUPTED, {
            question: response.question,
          });
        })
        .catch((error) => {
          console.error(
            'Failed to update thread response answer detail status',
            error,
          );
          contentMap.remove(queryId);
          telemetry.sendEvent(
            TelemetryEvent.HOME_ANSWER_QUESTION_INTERRUPTED,
            {
              question: response.question,
              error: error,
            },
            null,
            false,
          );
        });
    });
  } catch (error) {
    console.error(error);
    res.status(500).end();
  }
}
