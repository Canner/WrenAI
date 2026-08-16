import path from "node:path";
import { describe, expect, it } from "vitest";
import { HARNESS_PROFILE_IDENTITY_ERROR } from "../server/native-dispatch-registry.js";
import { createHarnessProfileSources } from "../server/harness-profile-sources.js";

describe("Harness profile sources", () => {
  it("derives every closed purpose source from the boot-owned analysis source", () => {
    const analysis = path.resolve("/configured/profiles/genbi-default");
    expect(createHarnessProfileSources(analysis)).toEqual({
      analysis,
      setup: path.resolve("/configured/profiles/genbi-setup"),
      context_enrichment: path.resolve("/configured/profiles/genbi-enrich-context"),
    });
  });

  it("fails closed at boot when the configured analysis source is not genbi-default", () => {
    expect(() => createHarnessProfileSources("/configured/profiles/attacker-selected-profile")).toThrow(HARNESS_PROFILE_IDENTITY_ERROR);
  });
});
