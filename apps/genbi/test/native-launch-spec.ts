import path from "node:path";

/**
 * The one place this repository describes Warble's native launch-spec shape.
 *
 * Four test files used to each carry their own hand-written copy of it. That is the same failure
 * mode this contract was changed to remove: a mirror of another repository's output, maintained by
 * hand, which stays green while drifting — because both the fixture and the expectation are ours.
 *
 * Two things keep this honest. Every caller builds from here, so a format change is one edit
 * rather than four. And `native-launch-spec-contract.test.ts` runs the real `warble` binary and
 * asserts this builder still matches what it emits, so drift fails a test instead of passing one.
 *
 * Negative cases pass `overrides` to corrupt exactly one field, which keeps "what is wrong with
 * this spec" visible at the call site instead of buried in a divergent copy.
 */
export interface NativeLaunchSpecOptions {
  readonly version: "2" | "4";
  readonly target: string;
  readonly purpose: string;
  readonly out: string;
  readonly scope: Record<string, unknown>;
  /** Entry verb the caller declared; the dispatcher reproduces it in argv. */
  readonly entryVerb: string;
  /** Declared first turn. v4 carries it in argv; v2 predates it. */
  readonly welcome?: string;
  readonly scopeEntry?: boolean;
  readonly profile?: string;
  readonly mcp?: boolean;
  readonly overrides?: Record<string, unknown>;
}

export function buildNativeLaunchSpec(options: NativeLaunchSpecOptions): Record<string, unknown> {
  const { version, target, purpose, out, scope, entryVerb, welcome, scopeEntry = false, profile } = options;
  const claude = target === "claude-code:interactive";
  const codexSkill = `genbi-${purpose === "context_enrichment" ? "enrich-context" : purpose}`;
  const v4 = version === "4";
  const argv = v4
    ? scopeEntry ? [welcome] : claude ? ["--agent", entryVerb, welcome] : [welcome]
    : scopeEntry ? [] : claude ? ["--agent", entryVerb] : [];
  // The two spec versions carry the scope differently, and this is the only place that says so:
  // v4 replaces the echoed scope document with the MCP descriptor, keeping only the bootstrap root
  // a Setup session needs, while v2 echoes the scope and knows nothing about MCP.
  const scopeOrMcp = v4
    ? {
        mcp: { server_name: "genbi_session", credential_env_var: "WARBLE_MCP_CONNECTION_CREDENTIAL" },
        ...(purpose === "setup" ? { bootstrap_root: scope.bootstrap_root } : {}),
      }
    : { scope };
  return {
    version,
    target,
    purpose,
    executable: claude ? "claude" : "codex",
    argv,
    agent: scopeEntry
      ? { kind: "claude_scope", name: profile }
      : claude ? { kind: "claude_agent", name: entryVerb } : { kind: "codex_skill", name: codexSkill },
    ...scopeOrMcp,
    cwd: out,
    artifact_root: out,
    handoff_path: path.join(out, "RUN.md"),
    ...options.overrides,
  };
}
