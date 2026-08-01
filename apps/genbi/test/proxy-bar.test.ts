import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");
const srcDir = path.join(repoRoot, "src");

/**
 * Another prohibition: a proxy relay (e.g. ccflare) may never be
 * embedded in the product's subscription path (that's a standing relay,
 * not personal-use auth). This isn't a runtime detector — there's nothing
 * to detect — it's a structural assertion that the codebase never gained a
 * proxy-relay dependency or import, so a future change that quietly wires
 * one in fails a test instead of merging silently.
 */
const PROXY_RELAY_IMPORT_PATTERN = /from\s+["'](?:ccflare|@ccflare\/[\w-]*|https?-proxy[\w-]*|proxy-agent)["']/i;

function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("proxy bar (no embedded proxy relay for subscription auth)", () => {
  it("package.json declares no proxy-relay dependency", async () => {
    const packageJson = (await import(path.join(repoRoot, "package.json"), {
      with: { type: "json" },
    })) as { default: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } };
    const names = [
      ...Object.keys(packageJson.default.dependencies ?? {}),
      ...Object.keys(packageJson.default.devDependencies ?? {}),
    ];
    for (const name of names) {
      expect(name).not.toMatch(/ccflare|https?-proxy|proxy-agent/i);
    }
  });

  it("no source file imports a proxy-relay package", () => {
    const offenders = listTsFiles(srcDir).filter((file) =>
      PROXY_RELAY_IMPORT_PATTERN.test(readFileSync(file, "utf-8")),
    );
    expect(offenders).toEqual([]);
  });

  it("Mode B shells only the resolved warble-agent-sdk CLI (never a proxy binary) — by construction", async () => {
    const { buildAgentSdkChatArgs } = await import("../harness/route/mode-b.js");
    const command = buildAgentSdkChatArgs(
      { command: "warble-agent-sdk", prefixArgs: [] },
      {
        irPath: "/fixture/ir.json",
        userProject: "/fixture/project",
        question: "who is our top customer?",
        outDir: "/tmp/out",
        warbleBin: "/opt/warble",
      },
    );
    // The spawned command is exactly the resolved agent-sdk CLI (see resolveAgentSdkCli:
    // PATH lookup or the sibling dev-mode tsx invocation) plus a fixed `chat` argv — there
    // is no code path here that inserts a proxy/relay host or process.
    expect(command.command).toBe("warble-agent-sdk");
    expect(command.args).not.toContain("--proxy");
    expect(command.args.join(" ")).not.toMatch(/ccflare|https?-proxy/i);
  });
});
