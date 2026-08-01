import { describe, expect, it } from "vitest";
import { buildAgentSdkManifestArgs } from "../harness/route/agent-sdk-manifest.js";
import type { ResolvedCli } from "../harness/route/agent-sdk-cli.js";

describe("buildAgentSdkManifestArgs (pure, no environment dependency)", () => {
  it("builds a bare `manifest <ir> --project <userProject>` argv with no --out (stdout stays pure JSON)", () => {
    const cli: ResolvedCli = { command: "warble-agent-sdk", prefixArgs: [] };

    const command = buildAgentSdkManifestArgs(cli, {
      irPath: "/tmp/ir.json",
      userProject: "/tmp/some-project",
    });

    expect(command.command).toBe("warble-agent-sdk");
    expect(command.args).toEqual(["manifest", "/tmp/ir.json", "--project", "/tmp/some-project"]);
    expect(command.args).not.toContain("--out");
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
    expect(command.args.slice(2)).toEqual(["/tmp/ir.json", "--project", "/tmp/some-project"]);
  });
});
