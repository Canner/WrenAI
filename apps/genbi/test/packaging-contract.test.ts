import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const packageJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
  files: string[];
  scripts: Record<string, string>;
};

describe("installed-package and vendor-contract CI wiring", () => {
  it("keeps repository-only scripts out of the published allowlist and exposes the packed-install check", () => {
    expect(packageJson.files).not.toContain("scripts");
    expect(packageJson.scripts["check:installed-package"]).toBe("node scripts/installed-package-acceptance.mjs");
  });

  it("keeps the deterministic vendor-contract entry point explicit", () => {
    expect(packageJson.scripts["check:vendor-contract"]).toBe("node scripts/run-vendor-contract-probes.mjs");
  });

  it("keeps the packed-install runner on the real connect/SSE path and scrubs bootstrap selectors", () => {
    const runner = readFileSync(path.join(packageRoot, "scripts", "installed-package-acceptance.mjs"), "utf8");
    expect(runner).toContain("/api/setup/connect");
    expect(runner).toContain("readSseFrames");
    expect(runner).toContain("Setup connect did not persist its step transition");
    for (const key of [
      "WREN_HARNESS_PROFILE",
      "WREN_HARNESS_OUT",
      "WREN_HARNESS_MODELS_CONFIG",
      "WREN_PROJECT_HOME",
      "WREN_HARNESS_SETUP_IR",
      "WREN_HARNESS_ANALYSIS_IR",
      "WREN_HARNESS_ENRICH_IR",
      "WREN_HARNESS_ARTIFACTS_DIR",
      "WREN_HARNESS_SETUP_MAX_TURNS",
      "WREN_HARNESS_NATIVE_MCP_URL",
      "WREN_HARNESS_WREN_SHIM",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
    ]) expect(runner).toContain(`"${key}"`);
  });

  it("runs the vendor contract on macOS and labels it as a tested baseline", () => {
    const workflow = readFileSync(path.join(repositoryRoot, ".github", "workflows", "genbi-ci.yml"), "utf8");
    expect(workflow).toContain("runs-on: macos-14");
    expect(workflow).toContain("macOS deterministic vendor contracts (tested baseline)");
    expect(workflow).toContain("node scripts/run-vendor-contract-probes.mjs");
  });
});
