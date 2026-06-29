import {
  getLogger as getLog4jsLogger,
  type Logger,
  type LoggingEvent,
} from 'log4js';

const DEFAULT_LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const DEBUG_ENABLED = DEFAULT_LOG_LEVEL.toLowerCase() === 'debug';
const wrappedLoggers = new WeakMap<Logger, Logger>();

const normalizeLevel = (level: unknown) => {
  const requestedLevel =
    typeof level === 'string' ? level.toLowerCase() : String(level);

  if (requestedLevel === 'debug' && !DEBUG_ENABLED) {
    return DEFAULT_LOG_LEVEL;
  }

  return level;
};

export const getLogger = (category?: string): Logger => {
  const logger = getLog4jsLogger(category);
  const cachedLogger = wrappedLoggers.get(logger);

  if (cachedLogger) {
    return cachedLogger;
  }

  logger.level = DEFAULT_LOG_LEVEL;

  const wrappedLogger = new Proxy(logger, {
    set(target, property, value, receiver) {
      if (property === 'level') {
        target.level = normalizeLevel(value) as string;
        return true;
      }

      return Reflect.set(target, property, value, receiver);
    },
  });

  wrappedLoggers.set(logger, wrappedLogger);
  return wrappedLogger;
};

export type { Logger, LoggingEvent };
