import { accessSync, constants as fsConstants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Injectable "is this CLI usable right now" check for `detectAndPick`. Kept
 * as an interface — rather than baked directly into `detectAndPick` — so
 * tests can inject a mock and stay fully offline, never touching `PATH` or
 * the filesystem.
 */
export interface LoginProbe {
  claudeLoggedIn(): boolean | Promise<boolean>;
  codexLoggedIn(): boolean | Promise<boolean>;
}

const WINDOWS_EXECUTABLE_EXTENSIONS = [".exe", ".cmd", ".bat"];

/** Best-effort, side-effect-light check that `binaryName` resolves on `PATH`. Never invokes the binary. */
function resolvesOnPath(binaryName: string): boolean {
  const pathEnv = process.env.PATH ?? "";
  const candidateNames =
    process.platform === "win32"
      ? [binaryName, ...WINDOWS_EXECUTABLE_EXTENSIONS.map((ext) => `${binaryName}${ext}`)]
      : [binaryName];

  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const name of candidateNames) {
      try {
        accessSync(join(dir, name), fsConstants.X_OK);
        return true;
      } catch {
        // not in this directory — keep looking
      }
    }
  }
  return false;
}

/** Cheap "has this CLI ever logged in" signal: does its credential/config file exist? Never reads its contents. */
function hasCredentialFile(relativePathFromHome: string): boolean {
  return existsSync(join(homedir(), relativePathFromHome));
}

/**
 * Real default `LoginProbe`. Best-effort and side-effect-light: it only
 * resolves the CLI binary on `PATH` and checks whether a credential/config
 * file exists next to it — it never invokes `claude`/`codex` and never
 * makes a network call. Production callers use this; tests should inject a
 * mock `LoginProbe` instead.
 */
export function createDefaultLoginProbe(): LoginProbe {
  return {
    claudeLoggedIn(): boolean {
      return resolvesOnPath("claude") && hasCredentialFile(".claude.json");
    },
    codexLoggedIn(): boolean {
      return resolvesOnPath("codex") && hasCredentialFile(".codex/auth.json");
    },
  };
}
