import { Telemetry } from '../telemetry/telemetry';

export interface IBackgroundTracker<R> {
  // _ indicates private
  _tasks: Record<number, R>;
  _intervalTime: number;
  _runningJobs: Set<any>;
  _telemetry: Telemetry;

  start(): void;
  addTask(task: R): void;
  getTasks(): Record<number, R>;
}
