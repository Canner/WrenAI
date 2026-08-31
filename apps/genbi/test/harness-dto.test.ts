import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHarnessDto } from "../server/harness.js";
import { Store } from "../server/db.js";
import { loadBundle } from "../harness/index.js";
import type { RouteOptions } from "../harness/index.js";
import { buildSyntheticBundle } from "./synthetic-bundle.js";
import { readFixture } from "./fixtures.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(testDir, "fixtures");

const BASE_ROUTE_OPTIONS: Omit<RouteOptions, "question" | "onEvent"> = {
  authChoice: { mode: "api-key", adapter: "mock" },
  profileSource: "/fixture/profile",
  userProject: "/fixture/project",
};

describe("buildHarnessDto — real genbi-default bundle", () => {
  const bundle = loadBundle(readFixture("genbi-default.bundle.json"));

  it("maps profile identity, including a verifyGate derived from answer_query's locked gated_check and a not-yet-bound status", () => {
    const store = new Store(":memory:");
    const dto = buildHarnessDto(bundle, store, BASE_ROUTE_OPTIONS);

    expect(dto.profile).toEqual({
      id: "genbi-default",
      name: "Genbi Default",
      boundContext: "project",
      verifyGate: true,
      bundleId: "genbi-default@vercel:headless",
      bundleVersion: "0.1",
      irVersion: "0.6",
      dispatchTarget: "vercel:headless",
      bundleHash: expect.stringMatching(/^[0-9a-f]{7}$/),
      status: "Not bound yet",
    });
  });

  it("derives a stable bundleHash across repeated calls (deterministic, no timestamp)", () => {
    const store = new Store(":memory:");
    const first = buildHarnessDto(bundle, store, BASE_ROUTE_OPTIONS).profile.bundleHash;
    const second = buildHarnessDto(bundle, store, BASE_ROUTE_OPTIONS).profile.bundleHash;
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{7}$/);
  });

  it("reports profile.status as Bound once Setup's compile-bind step is done", () => {
    const store = new Store(":memory:");
    const steps = store.getSetupSteps().map((step) => (step.key === "bind" ? { ...step, state: "done" as const } : step));
    store.setSetupSteps(steps);

    const dto = buildHarnessDto(bundle, store, BASE_ROUTE_OPTIONS);
    expect(dto.profile.status).toBe("Bound");
  });

  it("derives runtime.tierModels from the effective boot binding while Setup defaults remain unsaved", () => {
    const store = new Store(":memory:");
    // Seeded Setup rows are display defaults, not dispatch authority. The
    // boot api-key/mock binding has no concrete model, so say that honestly.
    const dto = buildHarnessDto(bundle, store, BASE_ROUTE_OPTIONS);

    expect(dto.runtime).toEqual({
      backend: "api-key",
      label: "API key (mock)",
      dispatcher: "in-process",
      tierModels: [
        { tier: "cheap", model: "mock (no fixed model)" },
        { tier: "strong", model: "mock (no fixed model)" },
      ],
    });
  });

  it("falls back to an honest '—' type/location (no fabricated generic label) when the bound project has no conn.yml to read", () => {
    const store = new Store(":memory:");
    const dto = buildHarnessDto(bundle, store, BASE_ROUTE_OPTIONS); // userProject "/fixture/project" has no conn.yml

    expect(dto.connection).toEqual({
      type: "—",
      location: "—",
      via: "—",
      tablesSynced: 3, // seeded models: customers, orders, products
      lastSync: "—",
      health: "healthy",
    });
  });

  it("reads the REAL datasource + connection location from the bound project's conn.yml/.env for a duckdb project", () => {
    const store = new Store(":memory:");
    const routeOptions = { ...BASE_ROUTE_OPTIONS, userProject: path.join(fixturesDir, "duckdb-project") };
    const dto = buildHarnessDto(bundle, store, routeOptions);

    expect(dto.connection).toMatchObject({
      type: "duckdb",
      location: "/tmp/fixtures/sample-duckdb", // resolved from ${DUCKDB_URL} via the project's .env
      via: "—",
      lastSync: "—",
    });
  });

  it("reads a DB-type datasource's host/database into the connection location and NEVER leaks its password/user into the DTO", () => {
    const store = new Store(":memory:");
    const routeOptions = { ...BASE_ROUTE_OPTIONS, userProject: path.join(fixturesDir, "postgres-project") };
    const dto = buildHarnessDto(bundle, store, routeOptions);

    expect(dto.connection).toMatchObject({
      type: "postgres",
      location: "db.internal.example:5432/analytics",
      via: "—",
      lastSync: "—",
    });

    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("super-secret-value-must-never-leak");
    expect(serialized).not.toContain("analytics_ro"); // the DB user must not leak either
  });

  describe("connection — resolved from wren_project.yml + ~/.wren/profiles.yml (the real, persistent sources — no conn.yml present)", () => {
    const originalWrenHome = process.env.WREN_HOME;

    beforeEach(() => {
      process.env.WREN_HOME = path.join(fixturesDir, "wren-home");
    });

    afterEach(() => {
      if (originalWrenHome === undefined) delete process.env.WREN_HOME;
      else process.env.WREN_HOME = originalWrenHome;
    });

    it("reads type from wren_project.yml's data_source and location from the pinned profile's fields, for a realistic project with NO conn.yml", () => {
      const store = new Store(":memory:");
      const routeOptions = { ...BASE_ROUTE_OPTIONS, userProject: path.join(fixturesDir, "manifest-only-duckdb-project") };
      const dto = buildHarnessDto(bundle, store, routeOptions);

      expect(dto.connection).toMatchObject({
        type: "duckdb",
        location: "/tmp/fixtures/manifest-duckdb",
        via: "—",
        lastSync: "—",
      });
    });

    it("resolves a credential-bearing bigquery profile's non-secret location fields and NEVER lets the profile's base64 credentials reach the DTO", () => {
      const store = new Store(":memory:");
      const routeOptions = { ...BASE_ROUTE_OPTIONS, userProject: path.join(fixturesDir, "manifest-only-bigquery-project") };
      const dto = buildHarnessDto(bundle, store, routeOptions);

      expect(dto.connection).toMatchObject({
        type: "bigquery",
        location: "fixture-project/fixture_dataset",
        via: "—",
        lastSync: "—",
      });

      const serialized = JSON.stringify(dto);
      expect(serialized).not.toContain("super-secret-value-must-never-leak-b64");
      expect(serialized).not.toContain("credentials");
    });

    it("shows the real data_source as type but an honest '—' location when the project has no profile: pin — and does NOT fall back to the profiles store's global active profile", () => {
      const store = new Store(":memory:");
      const routeOptions = { ...BASE_ROUTE_OPTIONS, userProject: path.join(fixturesDir, "manifest-only-nopin-project") };
      const dto = buildHarnessDto(bundle, store, routeOptions);

      expect(dto.connection).toMatchObject({
        type: "duckdb",
        location: "—", // must NOT be "/should/not/be/used" (the store's active: profile) — this project has no pin of its own
        via: "—",
        lastSync: "—",
      });
    });

    it("degrades gracefully to an honest '—' location when the project's profile: pin names a profile absent from the store (dangling pin)", () => {
      const store = new Store(":memory:");
      // The fixture's wren-home profiles.yml (fixture_duckdb, fixture_bigquery, other_active_profile)
      // has no entry named "profile_that_does_not_exist" — this is a real store, just missing this one pin.
      const routeOptions = { ...BASE_ROUTE_OPTIONS, userProject: path.join(fixturesDir, "manifest-only-danglingpin-project") };
      const dto = buildHarnessDto(bundle, store, routeOptions);

      expect(dto.connection).toMatchObject({
        type: "postgres",
        location: "—",
        via: "—",
        lastSync: "—",
      });
    });

    it("degrades gracefully to an honest '—' location when ~/.wren/profiles.yml doesn't exist at all", () => {
      process.env.WREN_HOME = path.join(fixturesDir, "wren-home-does-not-exist");
      const store = new Store(":memory:");
      const routeOptions = { ...BASE_ROUTE_OPTIONS, userProject: path.join(fixturesDir, "manifest-only-danglingpin-project") };
      const dto = buildHarnessDto(bundle, store, routeOptions);

      expect(dto.connection).toMatchObject({
        type: "postgres",
        location: "—",
        via: "—",
        lastSync: "—",
      });
    });

    it("degrades gracefully to an honest '—' location when profiles.yml exists but its profiles: block is empty/malformed", () => {
      process.env.WREN_HOME = path.join(fixturesDir, "wren-home-malformed");
      const store = new Store(":memory:");
      const routeOptions = { ...BASE_ROUTE_OPTIONS, userProject: path.join(fixturesDir, "manifest-only-danglingpin-project") };
      const dto = buildHarnessDto(bundle, store, routeOptions);

      expect(dto.connection).toMatchObject({
        type: "postgres",
        location: "—",
        via: "—",
        lastSync: "—",
      });
    });
  });

  it("produces one component per compiled agent, with distinct step tiers resolved to the REAL binding and capabilities/guardrails mapped", () => {
    const store = new Store(":memory:");
    const dto = buildHarnessDto(bundle, store, BASE_ROUTE_OPTIONS);

    expect(dto.components.map((c) => c.id)).toEqual(["explore_model", "answer_query", "generate_dashboard", "explain_change"]);

    const answerQuery = dto.components.find((c) => c.id === "answer_query");
    expect(answerQuery).toMatchObject({
      name: "Answer Query",
      componentType: "analytical",
      callableAs: "answer_query",
      model: "mock (no fixed model)", // last step (repair_sql) runs on tier "strong"; mock adapter has no concrete model
      tiers: [
        { tier: "cheap", model: "mock (no fixed model)" },
        { tier: "strong", model: "mock (no fixed model)" },
      ],
      status: "unavailable",
      unavailableReason: "The selected native session is unavailable.",
    });
    expect(answerQuery?.capabilities).toContainEqual({
      capability: "sql_execution:read_only",
      outcome: "native",
      providedBy: "runtime",
      criticality: "required",
    });
    expect(answerQuery?.guardrails).toContainEqual({ name: "deterministic_gate", enforcement: "gated_check", locked: true });
    expect(answerQuery?.guardrails).toContainEqual({ name: "row_limit", enforcement: "threshold_limit", locked: false, threshold: 1000 });
    expect(answerQuery?.guardrails).toContainEqual({ name: "statement_timeout", enforcement: "generic", locked: false, threshold: 30 });
  });

  it("surfaces each guardrail's threshold when the bundle declares one, and omits it otherwise", () => {
    const store = new Store(":memory:");
    const dto = buildHarnessDto(bundle, store, BASE_ROUTE_OPTIONS);

    const explainChange = dto.components.find((c) => c.id === "explain_change");
    expect(explainChange?.guardrails).toContainEqual({ name: "drill_depth_limit", enforcement: "threshold_limit", locked: false, threshold: 3 });
    // read_only_execution carries no threshold on any agent — must not appear on the mapped guardrail.
    expect(explainChange?.guardrails.find((g) => g.name === "read_only_execution")).toEqual({
      name: "read_only_execution",
      enforcement: "read_only",
      locked: true,
    });
  });

  it("maps realizationKind/trigger/outcome/tools/outputBlocks/steps from the real bundle for every component", () => {
    const store = new Store(":memory:");
    const dto = buildHarnessDto(bundle, store, BASE_ROUTE_OPTIONS);
    const byId = (id: string) => dto.components.find((c) => c.id === id)!;

    // Common agent metadata across the bundle.
    for (const id of ["explore_model", "answer_query", "generate_dashboard", "explain_change"]) {
      const component = byId(id);
      expect(component.realizationKind).toBe("skill");
      expect(component.trigger).toBe("one_shot");
      expect(component.outcome).toBe("none");
    }

    // explore_model: no anyOf/const in its output_schema -> defensively yields no output blocks.
    const exploreModel = byId("explore_model");
    expect(exploreModel.tools).toEqual([{ name: "semantic_introspect", source: "mcp:sample/semantic_introspect" }]);
    expect(exploreModel.outputBlocks).toEqual([]);
    expect(exploreModel.steps).toEqual([
      { name: "summarize_semantics", tier: "cheap", consumes: [], produces: "semantic_summary", realization: "independent" },
    ]);

    // answer_query: split cheap/strong steps, table+definition output blocks, a repair_fold step gated on_failure.
    const answerQuery = byId("answer_query");
    expect(answerQuery.tools).toEqual([{ name: "query", source: "mcp:sample/query" }]);
    expect(answerQuery.outputBlocks).toEqual(["table", "definition"]);
    expect(answerQuery.steps).toEqual([
      { name: "resolve_intent", tier: "cheap", consumes: [], produces: "query_intent", realization: "independent" },
      { name: "generate_sql", tier: "strong", consumes: ["query_intent"], produces: "query_result", realization: "independent" },
      {
        name: "repair_sql",
        tier: "strong",
        consumes: ["query_result"],
        produces: "repaired_result",
        realization: "repair_fold",
        guard: "on_failure",
        foldInto: "generate_sql",
        maxAttempts: 1,
      },
    ]);

    // generate_dashboard: 4-way output block union, tools incl. build_dashboard (mcp) + write_artifact (native).
    const generateDashboard = byId("generate_dashboard");
    expect(generateDashboard.tools).toEqual([
      { name: "query", source: "mcp:sample/query" },
      { name: "build_dashboard", source: "mcp:sample/build_dashboard" },
      { name: "write_artifact", source: "native" },
    ]);
    expect(generateDashboard.outputBlocks).toEqual(["kpi_card", "table", "chart", "definition"]);
    expect(generateDashboard.steps.map((s) => s.name)).toEqual(["plan_dashboard", "compose_layout"]);

    // explain_change: single-item (no anyOf) output_schema -> still yields its one block const.
    const explainChange = byId("explain_change");
    expect(explainChange.outputBlocks).toEqual(["narrative"]);
    expect(explainChange.steps.map((s) => s.name)).toEqual(["plan_decomposition", "synthesize_drivers"]);
  });

  it("resolves runtime and component tiers to a uniform boot model override", () => {
    const store = new Store(":memory:"); // seeded with claude-haiku/claude-sonnet
    const overrideRouteOptions: Omit<RouteOptions, "question" | "onEvent"> = {
      ...BASE_ROUTE_OPTIONS,
      authChoice: { mode: "api-key", adapter: "anthropic", config: { model: "gpt-4o" } },
    };

    const dto = buildHarnessDto(bundle, store, overrideRouteOptions);

    expect(dto.runtime.tierModels).toEqual([
      { tier: "cheap", model: "gpt-4o" },
      { tier: "strong", model: "gpt-4o" },
    ]);
    // Each component's own tiers/model still reflect the REAL binding as if it ran.
    const answerQuery = dto.components.find((c) => c.id === "answer_query");
    expect(answerQuery?.model).toBe("gpt-4o");
    expect(answerQuery?.tiers).toEqual([
      { tier: "cheap", model: "gpt-4o" },
      { tier: "strong", model: "gpt-4o" },
    ]);
  });

  it("resolves runtime and component tiers from a per-tier boot binding", () => {
    const store = new Store(":memory:");
    const hybridRouteOptions: Omit<RouteOptions, "question" | "onEvent"> = {
      ...BASE_ROUTE_OPTIONS,
      tierBinding: {
        cheap: { adapter: "anthropic", config: { model: "claude-haiku-hybrid" } },
        strong: { adapter: "anthropic", config: { model: "claude-opus-hybrid" } },
      },
    };

    const dto = buildHarnessDto(bundle, store, hybridRouteOptions);

    expect(dto.runtime.tierModels).toEqual([
      { tier: "cheap", model: "claude-haiku-hybrid" },
      { tier: "strong", model: "claude-opus-hybrid" },
    ]);
    const answerQuery = dto.components.find((c) => c.id === "answer_query");
    expect(answerQuery?.model).toBe("claude-opus-hybrid"); // last step (repair_sql) runs on tier "strong"
  });
});

describe("buildHarnessDto — synthetic bundles (mapping edge cases)", () => {
  it("preserves the closed unavailable variant as a redacted, non-executable component", () => {
    const raw = buildSyntheticBundle() as { agents: Record<string, unknown>[] } & Record<string, unknown>;
    const [available] = raw.agents;
    const bundle = loadBundle({
      ...raw,
      agents: [{
        ...available,
        steps: [],
        guardrails: {},
        tools: [],
        output_schema: {},
        capabilities: [],
        availability: {
          status: "unavailable",
          reason: "component is unavailable on the configured runtime",
        },
      }],
    });

    const dto = buildHarnessDto(bundle, new Store(":memory:"), BASE_ROUTE_OPTIONS, "analysis", {
      purposes: { analysis: { available: false, reason: "native host is unavailable" } },
    } as never);

    expect(dto.components[0]).toMatchObject({
      id: "synthetic_agent",
      status: "unavailable",
      unavailableReason: "component is unavailable on the configured runtime",
      model: "—",
      tiers: [],
      capabilities: [],
      guardrails: [],
      tools: [],
      outputBlocks: [],
      steps: [],
    });
  });

  it("marks otherwise available components unavailable when the selected native purpose is unavailable", () => {
    const bundle = loadBundle(buildSyntheticBundle({ guardrails: {} }));
    const dto = buildHarnessDto(bundle, new Store(":memory:"), BASE_ROUTE_OPTIONS, "analysis", {
      purposes: { analysis: { available: false, reason: "native host is unavailable" } },
    } as never);

    expect(dto.purpose).toMatchObject({ purpose: "analysis", available: false, reason: "native host is unavailable" });
    expect(dto.components[0]).toMatchObject({
      status: "unavailable",
      unavailableReason: "native host is unavailable",
    });
  });

  it("promotes a component unavailable on the compiled dispatch target to ready when the selected purpose's native session is available (rule-table row: compiled unavailable / native available)", () => {
    const raw = buildSyntheticBundle() as { agents: Record<string, unknown>[]; target: string } & Record<string, unknown>;
    const [available] = raw.agents;
    const bundle = loadBundle({
      ...raw,
      agents: [{
        ...available,
        steps: [],
        guardrails: {},
        tools: [],
        output_schema: {},
        capabilities: [],
        availability: {
          status: "unavailable",
          reason: "component is unavailable on the configured runtime",
        },
      }],
    });

    const dto = buildHarnessDto(bundle, new Store(":memory:"), BASE_ROUTE_OPTIONS, "context_enrichment", {
      purposes: { context_enrichment: { available: true, target: "claude-code:interactive", targetLabel: "Claude CLI" } },
    } as never);

    expect(dto.components[0]).toMatchObject({
      status: "ready",
      model: "—",
      tiers: [],
      capabilities: [],
      guardrails: [],
      tools: [],
      outputBlocks: [],
      steps: [],
      nativeAvailability: {
        viaLabel: "Claude CLI",
        compiledDispatchTarget: raw.target,
        compiledUnavailableReason: "component is unavailable on the configured runtime",
      },
    });
    // Promotion must never leak into `unavailableReason` — the row is `"ready"`, not a differently-worded unavailable.
    expect(dto.components[0]?.unavailableReason).toBeUndefined();
  });

  it("does not promote a compiled-unavailable component just because the native purpose has a target — availability must also be true (regression guard for the promotion condition)", () => {
    const raw = buildSyntheticBundle() as { agents: Record<string, unknown>[] } & Record<string, unknown>;
    const [available] = raw.agents;
    const bundle = loadBundle({
      ...raw,
      agents: [{
        ...available,
        steps: [],
        guardrails: {},
        tools: [],
        output_schema: {},
        capabilities: [],
        availability: {
          status: "unavailable",
          reason: "component is unavailable on the configured runtime",
        },
      }],
    });

    // `target`/`targetLabel` are present (so a naive `targetLabel !== undefined` check
    // alone would wrongly promote), but `available` is explicitly false — the native
    // session itself cannot run right now, so promotion must not happen.
    const dto = buildHarnessDto(bundle, new Store(":memory:"), BASE_ROUTE_OPTIONS, "context_enrichment", {
      purposes: { context_enrichment: { available: false, target: "claude-code:interactive", targetLabel: "Claude CLI", reason: "native host is unavailable" } },
    } as never);

    expect(dto.components[0]).toMatchObject({
      status: "unavailable",
      unavailableReason: "component is unavailable on the configured runtime",
    });
    expect(dto.components[0]?.nativeAvailability).toBeUndefined();
  });

  it("leaves an ordinary bundle-available component as ready when the selected purpose's native session is available (rule-table row: compiled available / native available, unchanged)", () => {
    const bundle = loadBundle(buildSyntheticBundle({ guardrails: {} }));
    const dto = buildHarnessDto(bundle, new Store(":memory:"), BASE_ROUTE_OPTIONS, "analysis", {
      purposes: { analysis: { available: true, target: "claude-code:interactive", targetLabel: "Claude CLI" } },
    } as never);

    expect(dto.components[0]).toMatchObject({ status: "ready" });
    expect(dto.components[0]?.nativeAvailability).toBeUndefined();
    expect(dto.components[0]?.unavailableReason).toBeUndefined();
  });

  it("keys promotion off which buildComponent branch produced the status, never off matching Warble's reason string (typed discriminator, not string equality)", () => {
    // An ORDINARY bundle-available component (no `availability` field at all) whose
    // purpose-level unavailable reason happens to be byte-identical to Warble's fixed
    // compiled-unavailable reason string. A string-matching implementation could mistake
    // this for the bundle-unavailable case; the correct implementation never takes that
    // branch here, so it must stay a plain purpose-level unavailable with no `nativeAvailability`.
    const bundle = loadBundle(buildSyntheticBundle({ guardrails: {} }));
    const dto = buildHarnessDto(bundle, new Store(":memory:"), BASE_ROUTE_OPTIONS, "analysis", {
      purposes: { analysis: { available: false, reason: "component is unavailable on the configured runtime" } },
    } as never);

    expect(dto.components[0]).toMatchObject({
      status: "unavailable",
      unavailableReason: "component is unavailable on the configured runtime",
    });
    expect(dto.components[0]?.nativeAvailability).toBeUndefined();
  });

  it("rejects an unknown availability discriminator instead of stripping it through the available variant", () => {
    const raw = buildSyntheticBundle() as { agents: Record<string, unknown>[] } & Record<string, unknown>;
    const [available] = raw.agents;

    expect(() => loadBundle({
      ...raw,
      agents: [{
        ...available,
        availability: {
          status: "ready",
          reason: "component is unavailable on the configured runtime",
        },
      }],
    })).toThrow("invalid bundle structure");
  });

  it("yields an empty outputBlocks when output_schema has no blocks.items.anyOf/const (defensive, not a throw)", () => {
    const bundle = loadBundle(buildSyntheticBundle({ guardrails: {} })); // output_schema: { type: "object", properties: {}, required: [] }
    const store = new Store(":memory:");
    const dto = buildHarnessDto(bundle, store, BASE_ROUTE_OPTIONS);
    expect(dto.components[0]?.outputBlocks).toEqual([]);
  });

  it("maps realizationKind/trigger/outcome/tools/steps for a synthetic single-step agent", () => {
    const bundle = loadBundle(
      buildSyntheticBundle({ guardrails: {}, trigger: "on_event", outcome: "artifact", tools: [{ name: "sample_tool", source: "native" }] }),
    );
    const store = new Store(":memory:");
    const dto = buildHarnessDto(bundle, store, BASE_ROUTE_OPTIONS);
    const component = dto.components[0]!;
    expect(component.realizationKind).toBe("skill");
    expect(component.trigger).toBe("on_event");
    expect(component.outcome).toBe("artifact");
    expect(component.tools).toEqual([{ name: "sample_tool", source: "native" }]);
    expect(component.steps).toEqual([{ name: "only_step", tier: "cheap", consumes: [], produces: "result", realization: "independent" }]);
  });

  it("falls back to the store's configured setting, visibly labeled, when a hybrid tierBinding doesn't cover the tier", () => {
    const bundle = loadBundle(buildSyntheticBundle({ guardrails: {} })); // single step, tier "cheap"
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), tierModels: [{ tier: "cheap", model: "claude-haiku" }] });
    const routeOptions: Omit<RouteOptions, "question" | "onEvent"> = {
      ...BASE_ROUTE_OPTIONS,
      tierBinding: { strong: { adapter: "anthropic", config: { model: "claude-opus" } } }, // doesn't cover "cheap"
    };

    const dto = buildHarnessDto(bundle, store, routeOptions);
    const component = dto.components[0];
    expect(component?.tiers).toEqual([{ tier: "cheap", model: "claude-haiku (configured)" }]);
    expect(component?.model).toBe("claude-haiku (configured)");
  });

  it("visibly falls back to configured settings when the effective binding cannot be derived", () => {
    const bundle = loadBundle(buildSyntheticBundle({ guardrails: {} })); // single step, tier "cheap"
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), tierModels: [{ tier: "cheap", model: "claude-haiku" }] });
    const routeOptions: Omit<RouteOptions, "question" | "onEvent"> = {
      ...BASE_ROUTE_OPTIONS,
      authChoice: { mode: "gateway" }, // no config.baseURL/model -> deriveAdapterSpec throws
    };

    const dto = buildHarnessDto(bundle, store, routeOptions);
    expect(dto.runtime.tierModels).toEqual([{ tier: "cheap", model: "claude-haiku (configured)" }]);
    expect(dto.components[0]?.model).toBe("claude-haiku (configured)");
  });

  it("falls back to an honest 'unbound' label when neither the real binding nor the store has anything for the tier", () => {
    const bundle = loadBundle(buildSyntheticBundle({ guardrails: {} })); // single step, tier "cheap"
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), tierModels: [{ tier: "strong", model: "claude-sonnet" }] }); // no "cheap" entry
    const routeOptions: Omit<RouteOptions, "question" | "onEvent"> = {
      ...BASE_ROUTE_OPTIONS,
      tierBinding: { strong: { adapter: "anthropic", config: { model: "claude-opus" } } }, // doesn't cover "cheap" either
    };

    const dto = buildHarnessDto(bundle, store, routeOptions);
    expect(dto.components[0]?.tiers).toEqual([{ tier: "cheap", model: "cheap (unbound)" }]);
  });

  it("reports explicit persisted per-tier models under subscription auth", () => {
    const bundle = loadBundle(buildSyntheticBundle({ guardrails: {} }));
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), tierModels: [{ tier: "cheap", model: "claude-haiku" }] });
    const routeOptions: Omit<RouteOptions, "question" | "onEvent"> = {
      ...BASE_ROUTE_OPTIONS,
      authChoice: { mode: "subscription", provider: "claude" },
    };

    const dto = buildHarnessDto(bundle, store, routeOptions);
    expect(dto.runtime.tierModels).toEqual([{ tier: "cheap", model: "claude-haiku" }]);
    expect(dto.runtime.label).toBe("Subscription (claude)"); // label still names the auth strategy
  });

  it("reports verifyGate false when no compiled agent has a locked gated_check guardrail", () => {
    const bundle = loadBundle(buildSyntheticBundle({ guardrails: { read_only_execution: { enforcement: "read_only", locked: true } } }));
    const store = new Store(":memory:");
    const dto = buildHarnessDto(bundle, store, BASE_ROUTE_OPTIONS);
    expect(dto.profile.verifyGate).toBe(false);
  });

  it("reports verifyGate true when a guardrail is a locked gated_check", () => {
    const bundle = loadBundle(buildSyntheticBundle({ guardrails: { some_gate: { enforcement: "gated_check", locked: true } } }));
    const store = new Store(":memory:");
    const dto = buildHarnessDto(bundle, store, BASE_ROUTE_OPTIONS);
    expect(dto.profile.verifyGate).toBe(true);
  });

  it.each([
    [{ mode: "subscription", provider: "claude" } as const, "subscription", "Subscription (claude)", "claude-agent-sdk"],
    [{ mode: "subscription", provider: "codex" } as const, "subscription", "Subscription (codex)", "codex-local"],
    [{ mode: "api-key", adapter: "mock" } as const, "api-key", "API key (mock)", "in-process"],
    [{ mode: "local" } as const, "local", "Local", "in-process"],
    [{ mode: "local", endpoint: "http://localhost:11434/v1" } as const, "local", "Local (http://localhost:11434/v1)", "in-process"],
    [{ mode: "gateway" } as const, "gateway", "Gateway", "in-process"],
  ])(
    "derives runtime.backend/label from authChoice %o — never the internal inProcess/dispatched dispatch bucket",
    (authChoice, expectedBackend, expectedLabel, expectedDispatcher) => {
      const bundle = loadBundle(buildSyntheticBundle());
      const store = new Store(":memory:");
      const dto = buildHarnessDto(bundle, store, { ...BASE_ROUTE_OPTIONS, authChoice });
      expect(dto.runtime.backend).toBe(expectedBackend);
      expect(dto.runtime.label).toBe(expectedLabel);
      expect(dto.runtime).not.toHaveProperty("mode");
      expect(dto.runtime.dispatcher).toBe(expectedDispatcher);
    },
  );

  it("derives runtime.dispatcher from the provider-specific product target", () => {
    const bundle = loadBundle(buildSyntheticBundle());
    const store = new Store(":memory:");

    const subscriptionDto = buildHarnessDto(bundle, store, {
      ...BASE_ROUTE_OPTIONS,
      authChoice: { mode: "subscription", provider: "claude" },
    });
    expect(subscriptionDto.runtime.dispatcher).toBe("claude-agent-sdk");

    const codexDto = buildHarnessDto(bundle, store, {
      ...BASE_ROUTE_OPTIONS,
      authChoice: { mode: "subscription", provider: "codex" },
    });
    expect(codexDto.runtime.dispatcher).toBe("codex-local");
    expect(codexDto.components.every((component) => component.status === "unavailable")).toBe(true);

    const apiKeyDto = buildHarnessDto(bundle, store, {
      ...BASE_ROUTE_OPTIONS,
      authChoice: { mode: "api-key", adapter: "mock" },
    });
    expect(apiKeyDto.runtime.dispatcher).toBe("in-process");
  });

  it("reports connection.health as degraded when there is no synced context (tablesSynced 0)", () => {
    const bundle = loadBundle(buildSyntheticBundle());
    const store = new Store(":memory:");
    store.setConfigJson("context.models", []);
    const dto = buildHarnessDto(bundle, store, BASE_ROUTE_OPTIONS);
    expect(dto.connection).toMatchObject({ tablesSynced: 0, health: "degraded" });
  });

  it.each([
    [{ mode: "subscription", provider: "claude" } as const, "claude-agent-sdk:setup", "Claude Setup runner"],
    [{ mode: "subscription", provider: "codex" } as const, "codex-local:setup", "Codex Setup runner"],
    [{ mode: "api-key", adapter: "mock" } as const, "in-process:setup", "In-process Setup runner"],
  ])("describes Setup through its provider-specific Setup runner for auth %o", (authChoice, target, targetLabel) => {
    const setupBundle = loadBundle(buildSyntheticBundle({ profile: "genbi-setup" }));
    const dto = buildHarnessDto(setupBundle, new Store(":memory:"), { ...BASE_ROUTE_OPTIONS, authChoice }, "setup", undefined, { available: true });
    expect(dto.purpose).toMatchObject({ executionKind: "setup_runner", target, targetLabel, available: true });
    expect(dto.purpose).not.toHaveProperty("reason");
  });
});
