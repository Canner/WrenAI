import { describe, expect, it } from "vitest";
import { ComplianceError, SUBSCRIPTION_TOS_WARNING } from "../harness/compliance/index.js";
import { route } from "../harness/route/index.js";
import type { ModeAExecutor, ModeAOptions, ModeBExecutor, ModeBOptions } from "../harness/route/index.js";
import type { AuthChoice } from "../harness/auth/index.js";

const PROFILE_SOURCE = "/fixture/profile";
const USER_PROJECT = "/fixture/project";
const QUESTION = "who is our top customer?";

function neverCalledModeA(): ModeAExecutor {
  return () => {
    throw new Error("modeA should not have been invoked");
  };
}

function neverCalledModeB(): ModeBExecutor {
  return () => {
    throw new Error("modeB should not have been invoked");
  };
}

describe("route (seam)", () => {
  it.each<AuthChoice>([
    { mode: "api-key", adapter: "anthropic" },
    { mode: "local", endpoint: "http://localhost:11434/v1" },
    { mode: "gateway", config: { baseURL: "https://gateway.example.com/v1", model: "gpt-4o" } },
  ])("routes %o to Mode A without invoking Mode B", async (authChoice) => {
    let received: ModeAOptions | undefined;
    const modeA: ModeAExecutor = async (options) => {
      received = options;
      return { kind: "answer", envelope: { blocks: [] } };
    };

    const result = await route({
      authChoice,
      profileSource: PROFILE_SOURCE,
      userProject: USER_PROJECT,
      question: QUESTION,
      modeA,
      modeB: neverCalledModeB(),
    });

    expect(result).toEqual({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [] } });
    expect(received?.authChoice).toEqual(authChoice);
    expect(received?.profileSource).toBe(PROFILE_SOURCE);
    expect(received?.userProject).toBe(USER_PROJECT);
    expect(received?.question).toBe(QUESTION);
  });

  it("routes a subscription AuthChoice to Mode B without invoking Mode A", async () => {
    const authChoice: AuthChoice = { mode: "subscription", provider: "claude" };
    let received: ModeBOptions | undefined;
    const modeB: ModeBExecutor = async (options) => {
      received = options;
      return { finalText: "Acme is the top customer by revenue." };
    };

    const result = await route({
      authChoice,
      profileSource: PROFILE_SOURCE,
      userProject: USER_PROJECT,
      question: QUESTION,
      modeA: neverCalledModeA(),
      modeB,
    });

    expect(result).toEqual({
      backend: "agent-sdk",
      warnings: [SUBSCRIPTION_TOS_WARNING],
      finalText: "Acme is the top customer by revenue.",
    });
    expect(received?.authChoice).toEqual(authChoice);
    expect(received?.profileSource).toBe(PROFILE_SOURCE);
    expect(received?.userProject).toBe(USER_PROJECT);
    expect(received?.question).toBe(QUESTION);
    expect(received?.deployment).toBe("personal");
  });

  it("passes model/warbleBin/workDir/bundle/mcpServers through to Mode A only when set", async () => {
    let received: ModeAOptions | undefined;
    const modeA: ModeAExecutor = async (options) => {
      received = options;
      return { kind: "answer", envelope: { blocks: [] } };
    };

    await route({
      authChoice: { mode: "local", endpoint: "http://localhost:11434/v1" },
      profileSource: PROFILE_SOURCE,
      userProject: USER_PROJECT,
      question: QUESTION,
      model: "llama3.1",
      warbleBin: "/opt/warble",
      workDir: "/tmp/workdir",
      modeA,
      modeB: neverCalledModeB(),
    });

    expect(received?.model).toBe("llama3.1");
    expect(received?.warbleBin).toBe("/opt/warble");
    expect(received?.workDir).toBe("/tmp/workdir");
    expect(received?.bundle).toBeUndefined();
    expect(received?.mcpServers).toBeUndefined();
  });

  it("passes warbleBin/agentSdkBin/outDir/workDir through to Mode B only when set", async () => {
    let received: ModeBOptions | undefined;
    const modeB: ModeBExecutor = async (options) => {
      received = options;
      return { finalText: "ok" };
    };

    await route({
      authChoice: { mode: "subscription", provider: "codex" },
      profileSource: PROFILE_SOURCE,
      userProject: USER_PROJECT,
      question: QUESTION,
      warbleBin: "/opt/warble",
      agentSdkBin: "/opt/warble-agent-sdk",
      outDir: "/tmp/outdir",
      workDir: "/tmp/workdir",
      modeA: neverCalledModeA(),
      modeB,
    });

    expect(received?.warbleBin).toBe("/opt/warble");
    expect(received?.agentSdkBin).toBe("/opt/warble-agent-sdk");
    expect(received?.outDir).toBe("/tmp/outdir");
    expect(received?.workDir).toBe("/tmp/workdir");
  });

  it("passes agentId through to Mode B when set, and leaves it unset by default", async () => {
    let received: ModeBOptions | undefined;
    const modeB: ModeBExecutor = async (options) => {
      received = options;
      return { finalText: "ok" };
    };

    await route({
      authChoice: { mode: "subscription", provider: "codex" },
      profileSource: PROFILE_SOURCE,
      userProject: USER_PROJECT,
      question: QUESTION,
      agentId: "connect_source",
      modeA: neverCalledModeA(),
      modeB,
    });

    expect(received?.agentId).toBe("connect_source");

    let receivedUnset: ModeBOptions | undefined;
    const modeBUnset: ModeBExecutor = async (options) => {
      receivedUnset = options;
      return { finalText: "ok" };
    };

    await route({
      authChoice: { mode: "subscription", provider: "codex" },
      profileSource: PROFILE_SOURCE,
      userProject: USER_PROJECT,
      question: QUESTION,
      modeA: neverCalledModeA(),
      modeB: modeBUnset,
    });

    expect(receivedUnset?.agentId).toBeUndefined();
  });

  describe("compliance gate wiring", () => {
    it("rejects subscription + deployment: hosted before invoking modeB", async () => {
      await expect(
        route({
          authChoice: { mode: "subscription", provider: "claude" },
          profileSource: PROFILE_SOURCE,
          userProject: USER_PROJECT,
          question: QUESTION,
          deployment: "hosted",
          modeA: neverCalledModeA(),
          modeB: neverCalledModeB(),
        }),
      ).rejects.toThrow(ComplianceError);
    });

    it("allows subscription + deployment: personal (and the default, deployment omitted) through to modeB", async () => {
      const modeB: ModeBExecutor = async () => ({ finalText: "ok" });

      for (const deployment of ["personal", undefined] as const) {
        await expect(
          route({
            authChoice: { mode: "subscription", provider: "claude" },
            profileSource: PROFILE_SOURCE,
            userProject: USER_PROJECT,
            question: QUESTION,
            ...(deployment !== undefined ? { deployment } : {}),
            modeA: neverCalledModeA(),
            modeB,
          }),
        ).resolves.toEqual({ backend: "agent-sdk", warnings: [SUBSCRIPTION_TOS_WARNING], finalText: "ok" });
      }
    });

    it("deployment: hosted does not affect non-subscription auth (still routes to modeA)", async () => {
      const modeA: ModeAExecutor = async () => ({ kind: "answer", envelope: { blocks: [] } });

      await expect(
        route({
          authChoice: { mode: "api-key", adapter: "anthropic" },
          profileSource: PROFILE_SOURCE,
          userProject: USER_PROJECT,
          question: QUESTION,
          deployment: "hosted",
          modeA,
          modeB: neverCalledModeB(),
        }),
      ).resolves.toEqual({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [] } });
    });
  });

  describe("warnings surfaced on RouteResult", () => {
    it("subscription + personal (default): warnings contains the ToS warning", async () => {
      const modeB: ModeBExecutor = async () => ({ finalText: "ok" });

      const result = await route({
        authChoice: { mode: "subscription", provider: "claude" },
        profileSource: PROFILE_SOURCE,
        userProject: USER_PROJECT,
        question: QUESTION,
        modeA: neverCalledModeA(),
        modeB,
      });

      expect(result.warnings).toEqual([SUBSCRIPTION_TOS_WARNING]);
    });

    it.each<AuthChoice>([
      { mode: "api-key", adapter: "anthropic" },
      { mode: "local", endpoint: "http://localhost:11434/v1" },
      { mode: "gateway", config: { baseURL: "https://gateway.example.com/v1", model: "gpt-4o" } },
    ])("%o: warnings is empty (only subscription auth carries the ToS warning)", async (authChoice) => {
      const modeA: ModeAExecutor = async () => ({ kind: "answer", envelope: { blocks: [] } });

      const result = await route({
        authChoice,
        profileSource: PROFILE_SOURCE,
        userProject: USER_PROJECT,
        question: QUESTION,
        modeA,
        modeB: neverCalledModeB(),
      });

      expect(result.warnings).toEqual([]);
    });
  });

  describe("hybrid: tierBinding/modelsConfig cross-mode guards", () => {
    it("passes tierBinding through to Mode A only when set", async () => {
      let received: ModeAOptions | undefined;
      const modeA: ModeAExecutor = async (options) => {
        received = options;
        return { kind: "answer", envelope: { blocks: [] } };
      };
      const tierBinding = { cheap: { adapter: "mock", config: {} }, strong: { adapter: "mock", config: {} } };

      await route({
        authChoice: { mode: "local", endpoint: "http://localhost:11434/v1" },
        profileSource: PROFILE_SOURCE,
        userProject: USER_PROJECT,
        question: QUESTION,
        tierBinding,
        modeA,
        modeB: neverCalledModeB(),
      });

      expect(received?.tierBinding).toEqual(tierBinding);
    });

    it("loud-fails when tierBinding is given alongside a subscription authChoice, without invoking modeB", async () => {
      await expect(
        route({
          authChoice: { mode: "subscription", provider: "claude" },
          profileSource: PROFILE_SOURCE,
          userProject: USER_PROJECT,
          question: QUESTION,
          tierBinding: { cheap: { adapter: "mock", config: {} } },
          modeA: neverCalledModeA(),
          modeB: neverCalledModeB(),
        }),
      ).rejects.toThrow(/tierBinding.*has no effect under a subscription/);
    });

    it("passes modelsConfig through to Mode B only when set", async () => {
      let received: ModeBOptions | undefined;
      const modeB: ModeBExecutor = async (options) => {
        received = options;
        return { finalText: "ok" };
      };

      await route({
        authChoice: { mode: "subscription", provider: "claude" },
        profileSource: PROFILE_SOURCE,
        userProject: USER_PROJECT,
        question: QUESTION,
        modelsConfig: "/tmp/models.yaml",
        modeA: neverCalledModeA(),
        modeB,
      });

      expect(received?.modelsConfig).toBe("/tmp/models.yaml");
    });

    it("passes agentId through to Mode A only when set", async () => {
      let received: ModeAOptions | undefined;
      const modeA: ModeAExecutor = async (options) => {
        received = options;
        return { kind: "answer", envelope: { blocks: [] } };
      };

      await route({
        authChoice: { mode: "api-key", adapter: "anthropic" },
        profileSource: PROFILE_SOURCE,
        userProject: USER_PROJECT,
        question: QUESTION,
        agentId: "explain_change",
        modeA,
        modeB: neverCalledModeB(),
      });

      expect(received?.agentId).toBe("explain_change");

      let receivedUnset: ModeAOptions | undefined;
      const modeAUnset: ModeAExecutor = async (options) => {
        receivedUnset = options;
        return { kind: "answer", envelope: { blocks: [] } };
      };
      await route({
        authChoice: { mode: "api-key", adapter: "anthropic" },
        profileSource: PROFILE_SOURCE,
        userProject: USER_PROJECT,
        question: QUESTION,
        modeA: modeAUnset,
        modeB: neverCalledModeB(),
      });
      expect(receivedUnset?.agentId).toBeUndefined();
    });

    it("loud-fails when modelsConfig is given alongside a non-subscription authChoice, without invoking modeA", async () => {
      await expect(
        route({
          authChoice: { mode: "api-key", adapter: "anthropic" },
          profileSource: PROFILE_SOURCE,
          userProject: USER_PROJECT,
          question: QUESTION,
          modelsConfig: "/tmp/models.yaml",
          modeA: neverCalledModeA(),
          modeB: neverCalledModeB(),
        }),
      ).rejects.toThrow(/modelsConfig.*has no effect under a "api-key"/);
    });
  });
});
