import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadBundle } from "../harness/bundle/loader.js";
import { createFileSystemCompileCache } from "../harness/compile/cache.js";
import { compileProfile } from "../harness/compile/pipeline.js";
import { resolveHubDir, resolveWarbleBinary } from "../harness/compile/resolve-binary.js";
import { getWarbleIdentity } from "../harness/compile/warble-identity.js";
import { WarbleBinaryNotFoundError } from "../harness/compile/errors.js";
import type { CompileCache } from "../harness/compile/types.js";
import { WARBLE_REPO } from "./warble-checkout.js";

/** This package's own `profiles/` tree — the GenBI profiles now live here, not in a Warble checkout. */
const PROFILES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "profiles");

const PROFILE_SOURCE = path.join(PROFILES_DIR, "genbi-default");
const JAFFLE_WREN = path.join(WARBLE_REPO, "examples", "jaffle-wren");

/** A fresh persistent cache each call, so its slot is the durable home for the returned artifacts. */
async function freshFsCache(): Promise<CompileCache> {
  return createFileSystemCompileCache({ cacheDir: await mkdtemp(path.join(tmpdir(), "wren-harness-compile-cache-")) });
}

async function isWarbleAvailable(): Promise<boolean> {
  try {
    await resolveWarbleBinary();
    return true;
  } catch {
    return false;
  }
}

const canRun = existsSync(PROFILE_SOURCE) && existsSync(JAFFLE_WREN) && (await isWarbleAvailable());

describe.skipIf(!canRun)("compileProfile against the real warble binary + genbi-default + jaffle-wren [opt-in integration]", () => {
  it("compiles an IR whose context_binding.project points at jaffle-wren, not the profile's fixture binding, and produces a vercel bundle that loads", async () => {
    const result = await compileProfile({
      profileSource: PROFILE_SOURCE,
      userProject: JAFFLE_WREN,
      mode: "agnostic",
      cache: await freshFsCache(),
    });

    expect(result.cacheHit).toBe(false);
    expect(existsSync(result.irPath)).toBe(true);
    expect(result.bundlePath).toBeDefined();
    expect(existsSync(result.bundlePath!)).toBe(true);
    // Durable home: artifacts live in the cache slot, not a leaked `wren-harness-compile-*` scratch dir.
    expect(result.irPath).not.toMatch(/wren-harness-compile-[^/]*[/]ir\.json$/);

    const ir = JSON.parse(await readFile(result.irPath, "utf-8"));
    const bindings = collectContextBindingProjects(ir);
    expect(bindings.length).toBeGreaterThan(0);
    for (const project of bindings) {
      // Resolved to jaffle-wren via an absolute path — proves the rewrite took effect, since the
      // profile's own fixture binding ships as the *relative* "../examples/jaffle-wren".
      expect(project).toBe(path.resolve(JAFFLE_WREN));
    }

    const bundleJson = JSON.parse(await readFile(result.bundlePath!, "utf-8"));
    const bundle = loadBundle(bundleJson); // throws on malformed structure — the sanity check
    expect(bundle.profile).toBe("genbi-default");
    expect(bundle.agents.length).toBeGreaterThan(0);
  });

  it("returns the cached artifact on a second call with an unchanged profile/context and never re-invokes warble", async () => {
    const cache: CompileCache = await freshFsCache();
    // Supplying `warbleIdentity` and `hubDir` explicitly means computing the cache key never needs
    // to resolve `warbleBin` at all (see `CompileProfileOptions.warbleIdentity`) — the precondition
    // for the second call below to prove a hit needs no binary, not even to identify it.
    const resolvedBin = await resolveWarbleBinary();
    const warbleIdentity = await getWarbleIdentity(resolvedBin);
    const hubDir = resolveHubDir(resolvedBin);
    const options = {
      profileSource: PROFILE_SOURCE,
      userProject: JAFFLE_WREN,
      mode: "agnostic" as const,
      cache,
      warbleIdentity,
      ...(hubDir !== undefined ? { hubDir } : {}),
    };

    const first = await compileProfile(options);
    expect(first.cacheHit).toBe(false);

    // An unresolvable warble binary would make any *recompile* fail loudly — proving this second
    // call is served entirely from the cache without shelling out again.
    const second = await compileProfile({ ...options, warbleBin: "/definitely/not/a/warble/binary" });
    expect(second.cacheHit).toBe(true);
    expect(second.irPath).toBe(first.irPath);
    expect(second.bundlePath).toBe(first.bundlePath);
  });

  it("recompiles when the user project (context) changes to a different project", async () => {
    const cache: CompileCache = await freshFsCache();
    const first = await compileProfile({ profileSource: PROFILE_SOURCE, userProject: JAFFLE_WREN, mode: "native", cache });
    // driftwood-wren — the repo's other checked-in, actually-parseable wren project (most other
    // examples/ entries are Warble *profiles*, not wren projects, and would fail context
    // preconditions rather than exercise the cache-miss path this test is after).
    const otherProject = path.join(WARBLE_REPO, "examples", "driftwood-wren");
    if (!existsSync(otherProject)) return; // environment-shape guard, not expected to trip here

    const second = await compileProfile({ profileSource: PROFILE_SOURCE, userProject: otherProject, mode: "native", cache });
    expect(second.cacheHit).toBe(false);
    expect(second.irPath).not.toBe(first.irPath);
  });
});

describe.skipIf(!canRun)("compileProfile error handling [opt-in integration]", () => {
  it("loud-fails with WarbleBinaryNotFoundError when warbleBin is explicit and missing, on a cache miss", async () => {
    await expect(
      compileProfile({
        profileSource: PROFILE_SOURCE,
        userProject: JAFFLE_WREN,
        mode: "native",
        warbleBin: "/definitely/not/a/warble/binary",
        cache: await freshFsCache(),
      }),
    ).rejects.toThrow(WarbleBinaryNotFoundError);
  });
});

/** Recursively collects every `context_binding.project` value found anywhere in the IR document. */
function collectContextBindingProjects(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectContextBindingProjects(item, out);
    return out;
  }
  if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if ("context_binding" in record) {
      const binding = record["context_binding"];
      if (binding !== null && typeof binding === "object" && "project" in (binding as Record<string, unknown>)) {
        out.push((binding as Record<string, unknown>)["project"] as string);
      }
    }
    for (const value of Object.values(record)) collectContextBindingProjects(value, out);
  }
  return out;
}
