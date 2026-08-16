import type { Capability, Guardrail } from "../harness/bundle/schema.js";

interface BuildBundleOptions {
  /** Defaults to a generic test-only profile; Harness identity tests opt into a canonical profile. */
  readonly profile?: string;
  readonly minIrVersion?: string;
  readonly maxIrVersion?: string;
  readonly capabilities?: readonly Capability[];
  readonly componentType?: string;
  readonly trigger?: string;
  readonly outcome?: string;
  readonly tools?: readonly { readonly name: string; readonly source: string }[];
  readonly guardrails?: Record<string, Guardrail>;
  /** Defaults to `"vercel:headless"` (the vercel dispatch target). Pass `"claude-agent-sdk:local"` for a manifest-flavored synthetic bundle. */
  readonly target?: string;
  /** Which top-level format-version key to emit (see `bundleSchema`'s doc comment) — defaults to `"vercel_bundle_version"`, matching every pre-existing caller. */
  readonly versionField?: "vercel_bundle_version" | "manifest_version";
}

export function buildSyntheticBundle(options: BuildBundleOptions = {}): unknown {
  const {
    profile = "synthetic-profile",
    minIrVersion = "0.5",
    maxIrVersion = "0.5",
    capabilities = [
      { capability: "llm:cheap", outcome: "native", provided_by: "runtime", criticality: "required" },
    ],
    componentType = "analytical",
    trigger = "one_shot",
    outcome = "none",
    tools = [],
    guardrails = {},
    target = "vercel:headless",
    versionField = "vercel_bundle_version",
  } = options;

  return {
    [versionField]: "0.1",
    compat: { min_ir_version: minIrVersion, max_ir_version: maxIrVersion },
    profile,
    target,
    agents: [
      {
        id: "synthetic_agent",
        verb: "do_thing",
        component_type: componentType,
        realization_kind: "skill",
        trigger,
        outcome,
        steps: [
          {
            name: "only_step",
            tier: "cheap",
            consumes: [],
            produces: "result",
            prompt: "do the thing",
            realization: { kind: "independent" },
          },
        ],
        guardrails,
        tools,
        output_schema: { type: "object", properties: {}, required: [] },
        capabilities,
      },
    ],
  };
}
