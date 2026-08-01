import type { LoginProbe } from "./probe.js";
import type { AuthChoice, AuthOption } from "./types.js";

/**
 * Enumerate the credential options available right now. A `subscription`
 * entry for a given provider only appears when `probe` reports that
 * provider's CLI as detected and logged in; `api-key`, `local`, and
 * `gateway` are always offered. This only reports availability — it does
 * not route requests through any option and does not apply any
 * compliance/policy judgment on top of the raw signal (later milestones).
 */
export async function detectAndPick(probe: LoginProbe): Promise<AuthOption[]> {
  const options: AuthOption[] = [];

  if (await probe.claudeLoggedIn()) {
    options.push({ mode: "subscription", provider: "claude" });
  }
  if (await probe.codexLoggedIn()) {
    options.push({ mode: "subscription", provider: "codex" });
  }

  options.push({ mode: "api-key" }, { mode: "local" }, { mode: "gateway" });

  return options;
}

/**
 * Turn a selected `AuthOption` into an `AuthChoice`. `api-key`/`gateway`
 * fields beyond `mode` are left as minimal placeholders — the routing layer
 * (a later milestone) is responsible for filling in the concrete
 * adapter/config.
 */
export function toAuthChoice(option: AuthOption): AuthChoice {
  switch (option.mode) {
    case "subscription":
      return { mode: "subscription", provider: option.provider };
    case "api-key":
      return { mode: "api-key", adapter: "" };
    case "local":
      return { mode: "local" };
    case "gateway":
      return { mode: "gateway" };
  }
}
