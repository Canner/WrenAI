import { execFile } from "node:child_process";
import { WrenBinaryNotFoundError } from "./errors.js";

/**
 * Preflights that a `wren` binary is resolvable on `PATH` (`wren --version`
 * exits 0) — mirrors `resolveWarbleBinary`'s PATH tier
 * (`../compile/resolve-binary.js`) for the `warble` binary. `wren` is a
 * separately-installed CLI, not a sibling repo this package sits beside, so
 * there is no explicit-override or sibling-repo-build tier here — just the
 * one PATH check. Throws {@link WrenBinaryNotFoundError} (loud-fail) so a
 * missing `wren` fails clearly before a native-tool run even starts, instead
 * of surfacing later as an opaque exec failure once the tool loop is already
 * mid-run (see `ExecResult.notFound` for the mid-run counterpart).
 */
export async function resolveWrenBinary(): Promise<void> {
  const onPath = await new Promise<boolean>((resolve) => {
    execFile("wren", ["--version"], (error) => resolve(!error));
  });
  if (!onPath) {
    throw new WrenBinaryNotFoundError(`not found on PATH (tried running "wren --version")`);
  }
}
