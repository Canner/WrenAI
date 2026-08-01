import { describe, expect, it } from "vitest";
import { loadBundle } from "../harness/bundle/loader.js";
import { assertCapabilities, CapabilityGateError } from "../harness/capability/gate.js";
import { createDefaultCapabilityRegistry, createRegistry } from "../harness/capability/registry.js";
import { readFixture } from "./fixtures.js";
import { buildSyntheticBundle } from "./synthetic-bundle.js";

describe("assertCapabilities: second gate", () => {
  it("passes for the golden bundle against the default registry", () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    expect(() => assertCapabilities(bundle, createDefaultCapabilityRegistry())).not.toThrow();
  });

  it("fails fast naming a missing required capability and its owning agent", () => {
    const bundle = loadBundle(
      buildSyntheticBundle({
        capabilities: [
          {
            capability: "sql_execution:read_only",
            outcome: "native",
            provided_by: "runtime",
            criticality: "required",
          },
        ],
      }),
    );
    const emptyRegistry = createRegistry([]);

    expect(() => assertCapabilities(bundle, emptyRegistry)).toThrow(CapabilityGateError);
    expect(() => assertCapabilities(bundle, emptyRegistry)).toThrow(/sql_execution:read_only/);
    expect(() => assertCapabilities(bundle, emptyRegistry)).toThrow(/synthetic_agent/);
  });

  it("ignores capabilities that are not required or safety-critical when missing", () => {
    const bundle = loadBundle(
      buildSyntheticBundle({
        capabilities: [
          {
            capability: "some:optional_thing",
            outcome: "native",
            provided_by: "runtime",
            criticality: "optional",
          },
        ],
      }),
    );
    expect(() => assertCapabilities(bundle, createRegistry([]))).not.toThrow();
  });
});
