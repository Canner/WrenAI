import { getLogger } from './logger';

const logger = getLogger('ShutdownRegistry');
logger.level = 'debug';

type ShutdownSignal = 'SIGINT' | 'SIGTERM';
type ShutdownCallback = () => void;

const SHUTDOWN_SIGNALS: ShutdownSignal[] = ['SIGINT', 'SIGTERM'];
const callbacks = new Set<ShutdownCallback>();
let hooksRegistered = false;
let shuttingDown = false;

const runShutdownCallbacks = (signal: ShutdownSignal) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  logger.info(
    `Received ${signal}, executing ${callbacks.size} shutdown callback(s)`,
  );
  callbacks.forEach((callback) => {
    try {
      callback();
    } catch (error) {
      logger.error(
        `Failed to execute shutdown callback: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
};

const ensureSignalHooks = () => {
  if (hooksRegistered || typeof process === 'undefined' || !process?.once) {
    return;
  }
  hooksRegistered = true;

  SHUTDOWN_SIGNALS.forEach((signal) => {
    process.once(signal, () => runShutdownCallbacks(signal));
  });
};

export const registerShutdownCallback = (
  callback: ShutdownCallback,
): (() => void) => {
  ensureSignalHooks();
  callbacks.add(callback);
  return () => {
    callbacks.delete(callback);
  };
};
