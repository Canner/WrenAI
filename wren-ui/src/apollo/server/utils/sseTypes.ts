// Server-Sent Events (SSE) types for real-time streaming APIs
export enum EventType {
  MESSAGE_START = 'message_start',
  MESSAGE_STOP = 'message_stop',
  STATE = 'state',
  CONTENT_BLOCK_START = 'content_block_start',
  CONTENT_BLOCK_DELTA = 'content_block_delta',
  CONTENT_BLOCK_STOP = 'content_block_stop',
  ERROR = 'error',
}

export enum StateType {
  SQL_GENERATION_START = 'sql_generation_start',
  SQL_GENERATION_UNDERSTANDING = 'sql_generation_understanding',
  SQL_GENERATION_SEARCHING = 'sql_generation_searching',
  SQL_GENERATION_PLANNING = 'sql_generation_planning',
  SQL_GENERATION_GENERATING = 'sql_generation_generating',
  SQL_GENERATION_CORRECTING = 'sql_generation_correcting',
  SQL_GENERATION_FINISHED = 'sql_generation_finished',
  SQL_GENERATION_FAILED = 'sql_generation_failed',
  SQL_GENERATION_STOPPED = 'sql_generation_stopped',
  SQL_GENERATION_SUCCESS = 'sql_generation_success',
  SQL_EXECUTION_START = 'sql_execution_start',
  SQL_EXECUTION_END = 'sql_execution_end',
}

export enum ContentBlockContentType {
  SUMMARY_GENERATION = 'summary_generation',
  EXPLANATION = 'explanation',
}

// Interfaces for request and events
export interface AsyncAskRequest {
  question: string;
  sampleSize?: number;
  language?: string;
  threadId?: string;
}

export interface BaseEvent {
  timestamp: number;
}

export interface MessageStartEvent extends BaseEvent {
  type: EventType.MESSAGE_START;
}

export interface MessageStopEvent extends BaseEvent {
  type: EventType.MESSAGE_STOP;
  data: {
    threadId: string;
    duration: number;
  };
}

export interface StateEvent extends BaseEvent {
  type: EventType.STATE;
  data: {
    state: StateType;
    [key: string]: any;
  };
}

export interface ContentBlockStartEvent extends BaseEvent {
  type: EventType.CONTENT_BLOCK_START;
  content_block: {
    type: 'text';
    name: ContentBlockContentType;
  };
}

export interface ContentBlockDeltaEvent extends BaseEvent {
  type: EventType.CONTENT_BLOCK_DELTA;
  delta: {
    type: 'text_delta';
    text: string;
  };
}

export interface ContentBlockStopEvent extends BaseEvent {
  type: EventType.CONTENT_BLOCK_STOP;
}

export interface ErrorEvent extends BaseEvent {
  type: EventType.ERROR;
  data: {
    error: string;
    code?: string;
  };
}

export type StreamEvent =
  | MessageStartEvent
  | MessageStopEvent
  | StateEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | ErrorEvent;
