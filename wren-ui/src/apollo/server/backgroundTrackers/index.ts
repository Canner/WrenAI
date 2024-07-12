import { Telemetry } from '../telemetry/telemetry';

export abstract class BackgroundTracker<R> {
  protected tasks: Record<number, R> = {};
  protected intervalTime: number = 1000;
  protected runningJobs: Set<any> = new Set();
  protected telemetry: Telemetry;

  public abstract start(): void;
  public abstract addTask(task: R): void;
  public abstract getTasks(): Record<number, R>;
}
