import { describe, expect, it } from "vitest";
import { buildAgentSdkManifestArgs } from "../harness/route/agent-sdk-manifest.js";
import type { ResolvedCli } from "../harness/route/agent-sdk-cli.js";

describe("buildAgentSdkManifestArgs (pure, no environment dependency)", () => {
  it("builds a display-only `manifest <ir> --include-unavailable --project <userProject>` argv with no --out", () => {
    const cli: ResolvedCli = { command: "warble-agent-sdk", prefixArgs: [] };

    const command = buildAgentSdkManifestArgs(cli, {
      irPath: "/tmp/ir.json",
      userProject: "/tmp/some-project",
    });

    expect(command.command).toBe("warble-agent-sdk");
    expect(command.args).toEqual(["manifest", "/tmp/ir.json", "--include-unavailable", "--project", "/tmp/some-project"]);
    expect(command.args).not.toContain("--out");
  });

  it("omits --project for a raw bootstrap manifest instead of inheriting a bound project", () => {
    const cli: ResolvedCli = { command: "warble-agent-sdk", prefixArgs: [] };

    const command = buildAgentSdkManifestArgs(cli, { irPath: "/tmp/bootstrap-ir.json" });

    expect(command.args).toEqual(["manifest", "/tmp/bootstrap-ir.json", "--include-unavailable"]);
    expect(command.args).not.toContain("--project");
  });

  it("prefixes a dev-mode tsx invocation with its script entry as a leading arg, not appended after the flags", () => {
    const cli: ResolvedCli = {
      command: "/repo/warble/dispatcher/claude-agent-sdk/node_modules/.bin/tsx",
      prefixArgs: ["/repo/warble/dispatcher/claude-agent-sdk/src/cli.ts"],
    };

    const command = buildAgentSdkManifestArgs(cli, {
      irPath: "/tmp/ir.json",
      userProject: "/tmp/some-project",
    });

    expect(command.command).toBe("/repo/warble/dispatcher/claude-agent-sdk/node_modules/.bin/tsx");
    expect(command.args[0]).toBe("/repo/warble/dispatcher/claude-agent-sdk/src/cli.ts");
    expect(command.args[1]).toBe("manifest");
    expect(command.args.slice(2)).toEqual(["/tmp/ir.json", "--include-unavailable", "--project", "/tmp/some-project"]);
  });
});
