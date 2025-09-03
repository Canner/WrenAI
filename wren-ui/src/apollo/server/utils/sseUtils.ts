import { NextApiResponse } from 'next';
import { AskResultStatus } from '@/apollo/server/models/adaptor';
import {
  EventType,
  StateType,
  StreamEvent,
  StateEvent,
  ErrorEvent,
  MessageStartEvent,
  MessageStopEvent,
} from './sseTypes';

/**
 * Send SSE event to client
 */
export const sendSSEEvent = (res: NextApiResponse, event: StreamEvent) => {
  const eventData = `data: ${JSON.stringify(event)}\n\n`;
  res.write(eventData);
};

/**
 * Send message start event to client
 */
export const sendMessageStart = (res: NextApiResponse) => {
  const messageStartEvent: MessageStartEvent = {
    type: EventType.MESSAGE_START,
    timestamp: Date.now(),
  };
  sendSSEEvent(res, messageStartEvent);
};

/**
 * Send message stop event to client
 */
export const sendMessageStop = (
  res: NextApiResponse,
  threadId: string,
  duration: number,
) => {
  const messageStopEvent: MessageStopEvent = {
    type: EventType.MESSAGE_STOP,
    data: {
      threadId,
      duration,
    },
    timestamp: Date.now(),
  };
  sendSSEEvent(res, messageStopEvent);
};

/**
 * Send state update to client
 */
export const sendStateUpdate = (
  res: NextApiResponse,
  state: StateType,
  data?: any,
) => {
  const stateEvent: StateEvent = {
    type: EventType.STATE,
    data: {
      state,
      ...data,
    },
    timestamp: Date.now(),
  };
  sendSSEEvent(res, stateEvent);
};

/**
 * Send error to client
 */
export const sendError = (
  res: NextApiResponse,
  error: string,
  code?: string,
  additionalData?: Record<string, any>,
) => {
  const errorEvent: ErrorEvent = {
    type: EventType.ERROR,
    data: {
      error,
      code,
      ...additionalData,
    },
    timestamp: Date.now(),
  };
  sendSSEEvent(res, errorEvent);
};

/**
 * Transform AskResultStatus to descriptive SQL generation state
 */
export const getSqlGenerationState = (status: AskResultStatus): StateType => {
  switch (status) {
    case AskResultStatus.UNDERSTANDING:
      return StateType.SQL_GENERATION_UNDERSTANDING;
    case AskResultStatus.SEARCHING:
      return StateType.SQL_GENERATION_SEARCHING;
    case AskResultStatus.PLANNING:
      return StateType.SQL_GENERATION_PLANNING;
    case AskResultStatus.GENERATING:
      return StateType.SQL_GENERATION_GENERATING;
    case AskResultStatus.CORRECTING:
      return StateType.SQL_GENERATION_CORRECTING;
    case AskResultStatus.FINISHED:
      return StateType.SQL_GENERATION_FINISHED;
    case AskResultStatus.FAILED:
      return StateType.SQL_GENERATION_FAILED;
    case AskResultStatus.STOPPED:
      return StateType.SQL_GENERATION_STOPPED;
    default:
      return StateType.SQL_GENERATION_UNDERSTANDING;
  }
};

/**
 * End the SSE stream with message stop event
 */
export const endStream = (
  res: NextApiResponse,
  threadId: string,
  startTime: number,
) => {
  // Send message stop event
  sendMessageStop(res, threadId, Date.now() - startTime);
  res.end();
};
