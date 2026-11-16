import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, renameSync, unlinkSync, fsyncSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { immutable, requireThat } from '../contracts.mjs';

// Single-owner local journal. Every committed transition replaces one fsynced
// snapshot, including its command receipts and event history, before any effect.
export class Store {
  #directory; #lock; #data; #closed = false;
  constructor(directory) {
    requireThat(isAbsolute(directory)); this.#directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.#lock = join(directory, 'owner.json');
    if (existsSync(this.#lock)) {
      const owner = JSON.parse(readFileSync(this.#lock));
      let alive = true;
      try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      requireThat(!alive); unlinkSync(this.#lock);
    }
    writeFileSync(this.#lock, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
    try {
      const file = join(directory, 'state.json');
      this.#data = existsSync(file) ? JSON.parse(readFileSync(file)) : {
        version: 1, revision: 0, task: null, receipts: {}, events: [], epoch: randomUUID(),
      };
      requireThat(this.#data.version === 1);
      this.change('host_started', state => {
        state.epoch = randomUUID();
        for (const task of Object.values(state.tasks ?? {})) task.reusable = false;
        if (state.task) {
          if (!['completed', 'failed', 'cancelled', 'unsupported', 'interrupted'].includes(state.task.state)) {
            state.task.state = 'interrupted'; state.task.reason = 'host_restarted';
          }
          state.task.pending = null; state.task.export = null; state.task.reusable = false;
        }
      });
    } catch (error) { unlinkSync(this.#lock); throw error; }
  }
  snapshot() { return immutable(this.#data); }
  change(event, mutate) {
    requireThat(!this.#closed);
    const next = structuredClone(this.#data); mutate(next); next.revision++;
    next.tasks ??= {};
    if (next.task) next.tasks[next.task.id] = structuredClone(next.task);
    next.events.push({ revision: next.revision, type: event, task_id: next.task?.id ?? null, at: Date.now() });
    const path = join(this.#directory, 'state.json'), temp = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(next)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, path);
    const dir = openSync(this.#directory, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
    this.#data = next; return this.snapshot();
  }
  close() { if (!this.#closed) { this.#closed = true; unlinkSync(this.#lock); } }
}
