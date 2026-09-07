import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error The workflow-only MJS helper deliberately has no emitted declaration.
import { approvedManifest, refetchExactPublishAssets, verifyExactPublishInventory } from "../scripts/managed-wren-release.mjs";

const roots: string[] = [];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const python = "cpython-3.11.16+fixture-aarch64-apple-darwin-install_only.tar.gz";
const wheel = "wrenai-0.13.0-py3-none-any.whl";

function fixture() {
  const pythonBytes = "python fixture"; const wheelBytes = "wheel fixture";
  const tag = "managed-wren-fixture"; const mirror = `https://github.com/Canner/WrenAI/releases/download/${tag}/`;
  const source = "https://files.pythonhosted.org/packages/fixture/";
  const wheels = [{ distribution: "wrenai", version: "0.13.0", filename: wheel, sourceUrl: source + wheel, sha256: hash(wheelBytes), url: mirror + wheel }];
  return {
    candidate: { activation: "staged", platform: "darwin-arm64", compatibility: { wren: "0.13.0" }, python: { upstream: { url: source + python, sha256: hash(pythonBytes) }, mirror: { url: mirror + python, sha256: hash(pythonBytes) } }, wheels },
    wheelInputs: wheels.map(({ url: _url, ...input }) => ({ ...input, license: "Apache-2.0" })),
    source: new Map([[source + python, pythonBytes], [source + wheel, wheelBytes]]),
  };
}

afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

describe("managed Wren protected publish exactness", () => {
  it("accepts the candidate's complete exact inventory and re-fetches only its approved source bytes", async () => {
    const value = fixture(); const target = mkdtempSync(path.join(tmpdir(), "genbi-managed-wren-publish-")); roots.push(target);
    const fetched: string[] = [];
    await expect(refetchExactPublishAssets(value.candidate, value.wheelInputs, target, async (url: string) => {
      fetched.push(String(url)); return new Response(value.source.get(String(url))!);
    })).resolves.toMatchObject({ python: { filename: python }, wheels: [{ filename: wheel }] });
    expect(fetched).toEqual([value.candidate.python.upstream.url, value.candidate.wheels[0]!.sourceUrl]);
    expect(readFileSync(path.join(target, wheel), "utf8")).toBe("wheel fixture");
    expect(approvedManifest(value.candidate)).toMatchObject({ activation: "approved", licenseApproval: { state: "approved" } });
  });

  it("rejects changed hashes, extra or missing wheel inventory, and wrong source or mirror filenames before fetch", () => {
    const value = fixture();
    for (const mutate of [
      (candidate: any, _inputs: any[]) => { candidate.wheels[0].sha256 = "f".repeat(64); },
      (_candidate: any, inputs: any[]) => { inputs.push({ ...inputs[0], filename: "extra-1.0.whl", sourceUrl: "https://files.pythonhosted.org/packages/fixture/extra-1.0.whl" }); },
      (_candidate: any, inputs: any[]) => { inputs.length = 0; },
      (candidate: any, _inputs: any[]) => { candidate.wheels[0].sourceUrl = "https://files.pythonhosted.org/packages/fixture/renamed.whl"; },
      (candidate: any, _inputs: any[]) => { candidate.wheels[0].url = "https://github.com/Canner/WrenAI/releases/download/other/" + wheel; },
    ]) {
      const candidate = JSON.parse(JSON.stringify(value.candidate)); const inputs = JSON.parse(JSON.stringify(value.wheelInputs)); mutate(candidate, inputs);
      expect(() => verifyExactPublishInventory(candidate, inputs)).toThrow();
    }
  });

  it("does not create a partial asset directory after an unapproved inventory failure", async () => {
    const value = fixture(); const target = mkdtempSync(path.join(tmpdir(), "genbi-managed-wren-publish-fail-")); roots.push(target);
    value.wheelInputs[0]!.sha256 = "e".repeat(64);
    await expect(refetchExactPublishAssets(value.candidate, value.wheelInputs, target, async () => new Response("unreachable"))).rejects.toThrow();
    expect(existsSync(path.join(target, python))).toBe(false);
  });

  it("refuses to anchor an approved manifest whose release identity differs from the staged package", () => {
    const root = mkdtempSync(path.join(tmpdir(), "genbi-managed-wren-anchor-")); roots.push(root); const packageRoot = path.join(root, "package"); mkdirSync(path.join(packageRoot, "managed-wren"), { recursive: true });
    const staged = JSON.parse(readFileSync(path.resolve("managed-wren", "manifest.json"), "utf8"));
    const approved = { ...staged, activation: "approved", licenseApproval: { state: "approved", evidence: "fixture" }, compatibility: { ...staged.compatibility, wren: "0.13.1" } };
    writeFileSync(path.join(packageRoot, "managed-wren", "manifest.json"), JSON.stringify(staged)); const approvedPath = path.join(root, "approved.json"); writeFileSync(approvedPath, JSON.stringify(approved));
    expect(() => execFileSync(process.execPath, [path.resolve("scripts", "anchor-managed-wren-manifest.mjs"), approvedPath, packageRoot], { cwd: path.resolve("."), stdio: "pipe" })).toThrow(/release identity differs/);
  });
});
