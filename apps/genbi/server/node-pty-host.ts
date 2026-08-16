import { closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync } from "node:fs";
import path from "node:path";
import { nativeTerminalEnvironment, type PtyFactory, type PtyProcess } from "./interactive-terminal.js";

interface NodePtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      cwd: string;
      cols: number;
      rows: number;
      name: string;
      env: NodeJS.ProcessEnv;
    },
  ): PtyProcess;
}

export interface PtyHostOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly probeExecutable?: string;
  readonly probeTimeoutMs?: number;
}

/**
 * node-pty 1.1 ships a small spawn-helper for prebuilt macOS binaries. Some
 * package managers restore that regular file without its executable mode,
 * making every PTY fork fail with the otherwise opaque `posix_spawnp failed`.
 * Repair only that fixed package-owned helper; a read-only installation will
 * fail closed in the spawn probe below and leave the copy-command fallback.
 */
export function ensureDarwinNodePtySpawnHelper(
  nodePtyEntry: string,
  platform = process.platform,
  arch = process.arch,
): void {
  if (platform !== "darwin") return;
  if (arch !== "arm64" && arch !== "x64") throw new Error("node-pty spawn helper is unavailable");

  const entry = path.resolve(nodePtyEntry);
  const packageRoot = path.resolve(path.dirname(entry), "..");
  // node-pty 1.1 has exactly this package entry and helper layout. Do not
  // generalize a permission repair to an arbitrary dependency path.
  if (entry !== path.join(packageRoot, "lib", "index.js")) {
    throw new Error("node-pty spawn helper is unavailable");
  }
  const prebuilds = path.join(packageRoot, "prebuilds");
  const platformPrebuild = path.join(prebuilds, `${platform}-${arch}`);
  const helper = path.join(platformPrebuild, "spawn-helper");

  // lstat never follows a link. Reject every package-owned component before
  // opening the helper so the fixed package path cannot be redirected.
  for (const directory of [packageRoot, prebuilds, platformPrebuild]) {
    if (!lstatSync(directory).isDirectory()) throw new Error("node-pty spawn helper is unavailable");
  }
  if (!lstatSync(helper).isFile()) throw new Error("node-pty spawn helper is unavailable");

  // Keep the chmod bound to the opened object, not the path. O_NOFOLLOW and
  // fchmod remove the final-component symlink and replacement race.
  const fd = openSync(helper, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("node-pty spawn helper is unavailable");
    if ((stat.mode & 0o111) === 0) fchmodSync(fd, stat.mode | 0o111);
  } finally {
    closeSync(fd);
  }
}

/**
 * Build the production PTY adapter only after a fixed, no-model Node process
 * successfully starts. Importability alone is not a readiness signal: native
 * helpers can load while process creation is still broken.
 */
export async function createProbedPtyFactory(
  nodePty: NodePtyModule,
  options: PtyHostOptions = {},
): Promise<PtyFactory> {
  const cwd = options.cwd ?? process.cwd();
  const env = nativeTerminalEnvironment(options.env);
  const probeExecutable = options.probeExecutable ?? process.execPath;
  const probeTimeoutMs = options.probeTimeoutMs ?? 2_000;

  let probe: PtyProcess;
  try {
    probe = nodePty.spawn(probeExecutable, ["--version"], {
      cwd,
      cols: 80,
      rows: 24,
      name: "xterm-256color",
      env,
    });
  } catch {
    throw new Error("interactive terminal host cannot spawn local processes");
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => {
      probe.kill();
      finish(new Error("interactive terminal host spawn probe timed out"));
    }, probeTimeoutMs);
    probe.onExit(({ exitCode }) => finish(exitCode === 0 ? undefined : new Error("interactive terminal host spawn probe failed")));
  });

  return {
    spawn: (file, args, spawnOptions) => nodePty.spawn(file, [...args], {
      cwd: spawnOptions.cwd,
      cols: spawnOptions.cols,
      rows: spawnOptions.rows,
      name: "xterm-256color",
      // Defend this lower adapter too: future PTY callers cannot bypass the
      // server-owned native-terminal color contract by supplying an env.
      env: nativeTerminalEnvironment(spawnOptions.env ?? env),
    }),
  };
}
