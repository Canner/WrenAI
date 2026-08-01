import path from "node:path";
import type { SetupMode } from "./wire-types.js";

/**
 * Builds the `setWrenHomeForSetupMode` function wired onto `TurnDeps` by `server/bin.ts` (see
 * `TurnDeps.setWrenHomeForSetupMode`'s doc comment in `server/turn.ts` for the full call-site
 * rationale). Pulled out of `bin.ts`'s closure into its own module so the exact logic that runs
 * in production is directly unit-testable, instead of only reachable through a mocked
 * `TurnDeps` in a route-level test.
 *
 * `workspaceRoot` and `originalWrenHome` are captured once at BFF boot (bootstrap-mode boots
 * only — a bound-mode boot has no `workspaceRoot` and never runs the setup wizard, so the
 * returned function is a no-op for it). `"create"` anchors `process.env.WREN_HOME` to
 * `<workspaceRoot>/.wren` so a scaffolded project's `wren profile add` writes into a fresh,
 * workspace-scoped `profiles.yml` instead of the operator's real `~/.wren/profiles.yml`.
 * `"adopt"` or `undefined` (e.g. after "Reset setup") restores `originalWrenHome`
 * exactly — deleting the env var entirely if the process never had it set, rather than forcing
 * some other default — since adopt is strictly read-only against global state and must keep
 * resolving the operator's own profiles.
 */
export function createSetWrenHomeForSetupMode(
  workspaceRoot: string | undefined,
  originalWrenHome: string | undefined,
): (mode: SetupMode | undefined) => void {
  return function setWrenHomeForSetupMode(mode: SetupMode | undefined): void {
    if (workspaceRoot === undefined) return; // only bootstrap-mode boots ever run the setup wizard
    if (mode === "create") {
      process.env["WREN_HOME"] = path.join(workspaceRoot, ".wren");
    } else if (originalWrenHome === undefined) {
      delete process.env["WREN_HOME"];
    } else {
      process.env["WREN_HOME"] = originalWrenHome;
    }
  };
}
