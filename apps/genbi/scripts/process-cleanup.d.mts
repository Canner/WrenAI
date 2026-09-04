import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { Server } from "node:net";

export function spawnProcessGroup(command: string, args: readonly string[], options?: SpawnOptions): ChildProcess;
export function stopProcessTree(child: ChildProcess, options?: { graceMs?: number; forceMs?: number }): Promise<void>;
export function runBounded(command: string, args: readonly string[], options?: SpawnOptions & { timeoutMs?: number }): Promise<{ stdout: string; stderr: string }>;
export function closeServerBounded(server: Server, options?: { timeoutMs?: number; forceMs?: number }): Promise<void>;
