import { describe, expect, it } from "vitest";
import { ComplianceError, SUBSCRIPTION_TOS_WARNING } from "../harness/compliance/index.js";
import { route } from "../harness/route/index.js";
import type { CodexAskExecutor, CodexAskOptions, InProcessExecutor, InProcessOptions, DispatchedExecutor, DispatchedOptions } from "../harness/route/index.js";
import type { AuthChoice } from "../harness/auth/index.js";

const PROFILE_SOURCE = "/fixture/profile";
const USER_PROJECT = "/fixture/project";
const QUESTION = "who is our top customer?";

function neverCalledInProcess(): InProcessExecutor {
  return () => {
    throw new Error("inProcess should not have been invoked");
  };
}

function neverCalledDispatched(): DispatchedExecutor {
  return () => {
    throw new Error("dispatched should not have been invoked");
  };
}

describe("route (seam)", () => {
  it.each<AuthChoice>([
    { mode: "api-key", adapter: "anthropic" },
    { mode: "local", endpoint: "http://localhost:11434/v1" },
    { mode: "gateway", config: { baseURL: "https://gateway.example.com/v1", model: "gpt-4o" } },
  ])("routes %o to in-process without invoking dispatched", async (authChoice) => {
    let received: InProcessOptions | undefined;
    const inProcess: InProcessExecutor = async (options) => {
      received = options;
      return { kind: "answer", envelope: { blocks: [] } };
    };

    const result = await route({
      authChoice,
      profileSource: PROFILE_SOURCE,
      userProject: USER_PROJECT,
      question: QUESTION,
      inProcess,
      dispatched: neverCalledDispatched(),
    });

    expect(result).toEqual({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [] } });
    expect(received?.authChoice).toEqual(authChoice);
    expect(received?.profileSource).toBe(PROFILE_SOURCE);
    expect(received?.userProject).toBe(USER_PROJECT);
    expect(received?.question).toBe(QUESTION);
  });

  it("routes a subscription AuthChoice to dispatched without invoking in-process", async () => {
    const authChoice: AuthChoice = { mode: "subscription", provider: "claude" };
    let received: DispatchedOptions | undefined;
    const dispatched: DispatchedExecutor = async (options) => {
      received = options;
      return { finalText: "Acme is the top customer by revenue." };
    };

    const result = await route({
      authChoice,
      profileSource: PROFILE_SOURCE,
      userProject: USER_PROJECT,
      question: QUESTION,
      inProcess: neverCalledInProcess(),
      dispatched,
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

  it("passes model/warbleBin/workDir/bundle/mcpServers through to in-process only when set", async () => {
    let received: InProcessOptions | undefined;
    const inProcess: InProcessExecutor = async (options) => {
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
      inProcess,
      dispatched: neverCalledDispatched(),
    });

    expect(received?.model).toBe("llama3.1");
    expect(received?.warbleBin).toBe("/opt/warble");
    expect(received?.workDir).toBe("/tmp/workdir");
    expect(received?.bundle).toBeUndefined();
    expect(received?.mcpServers).toBeUndefined();
  });

  it("passes warbleBin/agentSdkBin/outDir/workDir through to dispatched only when set", async () => {
    let received: DispatchedOptions | undefined;
    const dispatched: DispatchedExecutor = async (options) => {
      received = options;
      return { finalText: "ok" };
    };

    await route({
      authChoice: { mode: "subscription", provider: "claude" },
      profileSource: PROFILE_SOURCE,
      userProject: USER_PROJECT,
      question: QUESTION,
      warbleBin: "/opt/warble",
      agentSdkBin: "/opt/warble-agent-sdk",
      outDir: "/tmp/outdir",
      workDir: "/tmp/workdir",
      inProcess: neverCalledInProcess(),
      dispatched,
    });

    expect(received?.warbleBin).toBe("/opt/warble");
    expect(received?.agentSdkBin).toBe("/opt/warble-agent-sdk");
    expect(received?.outDir).toBe("/tmp/outdir");
    expect(received?.workDir).toBe("/tmp/workdir");
  });

  it("passes agentId through to dispatched when set, and leaves it unset by default", async () => {
    let received: DispatchedOptions | undefined;
    const dispatched: DispatchedExecutor = async (options) => {
      received = options;
      return { finalText: "ok" };
    };

    await route({
      authChoice: { mode: "subscription", provider: "claude" },
      profileSource: PROFILE_SOURCE,
      userProject: USER_PROJECT,
      question: QUESTION,
      agentId: "connect_source",
      inProcess: neverCalledInProcess(),
      dispatched,
    });

    expect(received?.agentId).toBe("connect_source");

    let receivedUnset: DispatchedOptions | undefined;
    const dispatchedUnset: DispatchedExecutor = async (options) => {
      receivedUnset = options;
      return { finalText: "ok" };
    };

    await route({
      authChoice: { mode: "subscription", provider: "claude" },
      profileSource: PROFILE_SOURCE,
      userProject: USER_PROJECT,
      question: QUESTION,
      inProcess: neverCalledInProcess(),
      dispatched: dispatchedUnset,
    });

    expect(receivedUnset?.agentId).toBeUndefined();
  });

  it("routes Codex subscription Ask only to codex:local with its explicit runtime bindings", async () => {
    let received: CodexAskOptions | undefined;
    const codexAsk: CodexAskExecutor = async (options) => {
      received = options;
      return { finalText: "verified" };
    };
    const models = { orchestrator: "driver", cheap: "cheap", strong: "strong" };
    const result = await route({
      authChoice: { mode: "subscription", provider: "codex" },
      profileSource: PROFILE_SOURCE,
      userProject: USER_PROJECT,
      question: QUESTION,
      inProcess: neverCalledInProcess(),
      dispatched: neverCalledDispatched(),
      codexAsk,
      codexModels: models,
      codexHome: "/private/codex-home",
      codexLocalBin: "/opt/warble-codex-local",
      codexBin: "/opt/codex",
      agentId: "generate_dashboard",
    });
    expect(result).toEqual({ backend: "codex-local", warnings: [SUBSCRIPTION_TOS_WARNING], finalText: "verified" });
    expect(received).toMatchObject({
      authChoice: { mode: "subscription", provider: "codex" },
      codexModels: models,
      codexHome: "/private/codex-home",
      codexLocalBin: "/opt/warble-codex-local",
      codexBin: "/opt/codex",
      agentId: "generate_dashboard",
    });
  });

  it("propagates a codex:local failure without invoking Claude or in-process", async () => {
    await expect(route({
      authChoice: { mode: "subscription", provider: "codex" },
      profileSource: PROFILE_SOURCE,
      userProject: USER_PROJECT,
      question: QUESTION,
      inProcess: neverCalledInProcess(),
      dispatched: neverCalledDispatched(),
      codexAsk: async () => { throw new Error("codex child failed"); },
    })).rejects.toThrow("codex child failed");
  });

  describe("compliance gate wiring", () => {
    it("rejects subscription + deployment: hosted before invoking dispatched", async () => {
      await expect(
        route({
          authChoice: { mode: "subscription", provider: "claude" },
          profileSource: PROFILE_SOURCE,
          userProject: USER_PROJECT,
          question: QUESTION,
          deployment: "hosted",
          inProcess: neverCalledInProcess(),
          dispatched: neverCalledDispatched(),
        }),
      ).rejects.toThrow(ComplianceError);
    });

    it("allows subscription + deployment: personal (and the default, deployment omitted) through to dispatched", async () => {
      const dispatched: DispatchedExecutor = async () => ({ finalText: "ok" });

      for (const deployment of ["personal", undefined] as const) {
        await expect(
          route({
            authChoice: { mode: "subscription", provider: "claude" },
            profileSource: PROFILE_SOURCE,
            userProject: USER_PROJECT,
            question: QUESTION,
            ...(deployment !== undefined ? { deployment } : {}),
            inProcess: neverCalledInProcess(),
            dispatched,
          }),
        ).resolves.toEqual({ backend: "agent-sdk", warnings: [SUBSCRIPTION_TOS_WARNING], finalText: "ok" });
      }
    });

    it("deployment: hosted does not affect non-subscription auth (still routes to inProcess)", async () => {
      const inProcess: InProcessExecutor = async () => ({ kind: "answer", envelope: { blocks: [] } });

      await expect(
        route({
          authChoice: { mode: "api-key", adapter: "anthropic" },
          profileSource: PROFILE_SOURCE,
          userProject: USER_PROJECT,
          question: QUESTION,
          deployment: "hosted",
          inProcess,
          dispatched: neverCalledDispatched(),
        }),
      ).resolves.toEqual({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [] } });
    });
  });

  describe("warnings surfaced on RouteResult", () => {
    it("subscription + personal (default): warnings contains the ToS warning", async () => {
      const dispatched: DispatchedExecutor = async () => ({ finalText: "ok" });

      const result = await route({
        authChoice: { mode: "subscription", provider: "claude" },
        profileSource: PROFILE_SOURCE,
        userProject: USER_PROJECT,
        question: QUESTION,
        inProcess: neverCalledInProcess(),
        dispatched,
      });

      expect(result.warnings).toEqual([SUBSCRIPTION_TOS_WARNING]);
    });

    it.each<AuthChoice>([
      { mode: "api-key", adapter: "anthropic" },
      { mode: "local", endpoint: "http://localhost:11434/v1" },
      { mode: "gateway", config: { baseURL: "https://gateway.example.com/v1", model: "gpt-4o" } },
    ])("%o: warnings is empty (only subscription auth carries the ToS warning)", async (authChoice) => {
      const inProcess: InProcessExecutor = async () => ({ kind: "answer", envelope: { blocks: [] } });

      const result = await route({
        authChoice,
        profileSource: PROFILE_SOURCE,
        userProject: USER_PROJECT,
        question: QUESTION,
        inProcess,
        dispatched: neverCalledDispatched(),
      });

      expect(result.warnings).toEqual([]);
    });
  });

  describe("hybrid: tierBinding/modelsConfig cross-mode guards", () => {
    it("passes tierBinding through to in-process only when set", async () => {
      let received: InProcessOptions | undefined;
      const inProcess: InProcessExecutor = async (options) => {
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
        inProcess,
        dispatched: neverCalledDispatched(),
      });

      expect(received?.tierBinding).toEqual(tierBinding);
    });

    it("loud-fails when tierBinding is given alongside a subscription authChoice, without invoking dispatched", async () => {
      await expect(
        route({
          authChoice: { mode: "subscription", provider: "claude" },
          profileSource: PROFILE_SOURCE,
          userProject: USER_PROJECT,
          question: QUESTION,
          tierBinding: { cheap: { adapter: "mock", config: {} } },
          inProcess: neverCalledInProcess(),
          dispatched: neverCalledDispatched(),
        }),
      ).rejects.toThrow(/tierBinding.*has no effect under a subscription/);
    });

    it("passes modelsConfig through to dispatched only when set", async () => {
      let received: DispatchedOptions | undefined;
      const dispatched: DispatchedExecutor = async (options) => {
        received = options;
        return { finalText: "ok" };
      };

      await route({
        authChoice: { mode: "subscription", provider: "claude" },
        profileSource: PROFILE_SOURCE,
        userProject: USER_PROJECT,
        question: QUESTION,
        modelsConfig: "/tmp/models.yaml",
        inProcess: neverCalledInProcess(),
        dispatched,
      });

      expect(received?.modelsConfig).toBe("/tmp/models.yaml");
    });

    it("passes agentId through to in-process only when set", async () => {
      let received: InProcessOptions | undefined;
      const inProcess: InProcessExecutor = async (options) => {
        received = options;
        return { kind: "answer", envelope: { blocks: [] } };
      };

      await route({
        authChoice: { mode: "api-key", adapter: "anthropic" },
        profileSource: PROFILE_SOURCE,
        userProject: USER_PROJECT,
        question: QUESTION,
        agentId: "explain_change",
        inProcess,
        dispatched: neverCalledDispatched(),
      });

      expect(received?.agentId).toBe("explain_change");

      let receivedUnset: InProcessOptions | undefined;
      const inProcessUnset: InProcessExecutor = async (options) => {
        receivedUnset = options;
        return { kind: "answer", envelope: { blocks: [] } };
      };
      await route({
        authChoice: { mode: "api-key", adapter: "anthropic" },
        profileSource: PROFILE_SOURCE,
        userProject: USER_PROJECT,
        question: QUESTION,
        inProcess: inProcessUnset,
        dispatched: neverCalledDispatched(),
      });
      expect(receivedUnset?.agentId).toBeUndefined();
    });

    it("loud-fails when modelsConfig is given alongside a non-subscription authChoice, without invoking inProcess", async () => {
      await expect(
        route({
          authChoice: { mode: "api-key", adapter: "anthropic" },
          profileSource: PROFILE_SOURCE,
          userProject: USER_PROJECT,
          question: QUESTION,
          modelsConfig: "/tmp/models.yaml",
          inProcess: neverCalledInProcess(),
          dispatched: neverCalledDispatched(),
        }),
      ).rejects.toThrow(/modelsConfig.*has no effect under a "api-key"/);
    });
  });
});
