/**
 * A native session must dispatch an IR compiled for the project it is bound to.
 *
 * It used to dispatch the profile's eval golden. A golden is that profile
 * compiled against warble's own example project, with that project's schema
 * baked into `context_binding.resolved` — so a session opened on a real
 * BigQuery project was told its models were jaffle-shop's customers and orders,
 * while the `wren` CLI in its cwd resolved the real one. The agent that hit this
 * noticed the contradiction and refused to draft; a less careful one would have
 * proposed a cube over columns that do not exist.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Reads a profile's shipped golden. Skipped when no warble checkout is
 * configured — this asserts a property OF the goldens, so it needs the real
 * ones rather than a fixture standing in for them.
 */
function golden(profileDir: string | undefined): { project?: string; resolvedCount: number } | undefined {
  if (profileDir === undefined) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path.join(profileDir, "ir.golden.json"), "utf-8")) as {
      context_binding?: { project?: string; resolved?: { models?: unknown[]; dimensions?: unknown[] } };
    };
    const binding = parsed.context_binding ?? {};
    const resolved = binding.resolved ?? {};
    return {
      ...(binding.project !== undefined ? { project: binding.project } : {}),
      resolvedCount: (resolved.models?.length ?? 0) + (resolved.dimensions?.length ?? 0),
    };
  } catch {
    return undefined;
  }
}

const analysisProfile = process.env["WREN_HARNESS_PROFILE"];
const profileRoot = analysisProfile === undefined ? undefined : path.dirname(analysisProfile);

describe("the goldens are fixtures, not runtime artifacts", () => {
  it("carries a foreign project's schema, which is exactly why it must not be dispatched", () => {
    const analysis = golden(analysisProfile);
    if (analysis === undefined) return; // no warble checkout configured here
    // If this ever stops being true, the golden has become project-neutral and
    // the reasoning behind compiling per-user should be revisited rather than
    // silently inherited.
    expect(analysis.project).toBeDefined();
    expect(analysis.resolvedCount).toBeGreaterThan(0);
  });

  it("leaves Setup's binding unresolved, which is why Setup never showed the symptom", () => {
    const setup = golden(profileRoot === undefined ? undefined : path.join(profileRoot, "genbi-setup"));
    if (setup === undefined) return;
    expect(setup.resolvedCount).toBe(0);
  });
});

describe("what a draft dispatches", () => {
  it("compiles from the profile source rather than short-circuiting on a prebuilt IR", async () => {
    const { draftProfileInput } = await import("../server/enrichment-runner.js");
    // With a source, `irPath` must be absent: passing it makes runModeBDefault
    // skip compileProfile, which is precisely how the fixture's context used to
    // reach the agent.
    expect(draftProfileInput("/profiles/genbi-enrich-context", "/profiles/genbi-enrich-context/ir.golden.json")).toEqual({
      profileSource: "/profiles/genbi-enrich-context",
    });
  });

  it("still accepts a prebuilt IR for a caller that has no profile source", async () => {
    const { draftProfileInput } = await import("../server/enrichment-runner.js");
    expect(draftProfileInput(undefined, "/somewhere/ir.json")).toEqual({
      profileSource: "/somewhere/ir.json",
      irPath: "/somewhere/ir.json",
    });
  });

  it("never returns both a source and an irPath, which would silently skip the compile", async () => {
    const { draftProfileInput } = await import("../server/enrichment-runner.js");
    for (const source of ["/profiles/x", undefined]) {
      const input = draftProfileInput(source, "/ir.json");
      if (source !== undefined) expect(input.irPath).toBeUndefined();
    }
  });
});

describe("resolveDispatchIr wiring", () => {
  it("is wired in production, so the no-resolver fallback is unreachable there", () => {
    // Source-level, and deliberately so: this asserts a wiring fact about
    // `bin.ts` that has no runtime seam short of booting a server. The
    // behavioural half — that the resolved path is what reaches dispatch — is
    // asserted by the compile checks above and by native-sessions' own suite.
    const bin = readFileSync(new URL("../server/bin.ts", import.meta.url), "utf-8");
    expect(bin).toMatch(/resolveDispatchIr: async \(purpose, binding\)/);
    expect(bin).toMatch(/compileProfile\(\{ profileSource, userProject: binding\.path/);
    expect(bin).toMatch(/compileRawProfile\(\{ profileSource/);
    expect((bin.match(/new NativeSessionService\(/g) ?? []).length).toBe(1);
  });
});
