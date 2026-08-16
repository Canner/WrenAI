/**
 * The catalog replaces four hand-maintained copies of "which data sources
 * exist" with one read of wren's own registry. These tests pin the two things
 * that made the copies dangerous: that parsing reflects what wren actually
 * says (including the variant sources, which are shaped differently), and that
 * an unreadable CLI degrades to a stated fallback rather than silently
 * pretending the short list is the whole truth.
 */
import { describe, expect, it } from "vitest";
import { loadSourceCatalog, parseSourceCatalog, resetSourceCatalogCache } from "../server/source-catalog.js";

describe("parseSourceCatalog", () => {
  it("reads fields, required flags and secret markers off a plain source", () => {
    const sources = parseSourceCatalog(
      JSON.stringify({
        postgres: {
          properties: {
            host: { title: "Host", type: "string" },
            password: { anyOf: [{ format: "password", type: "string" }, { type: "null" }], title: "Password" },
          },
          required: ["host"],
        },
      }),
    );
    expect(sources).toHaveLength(1);
    const [postgres] = sources;
    expect(postgres?.key).toBe("postgres");
    expect(postgres?.label).toBe("PostgreSQL");
    expect(postgres?.variants).toHaveLength(1);
    expect(postgres?.variants[0]?.fields).toEqual([
      { name: "host", label: "Host", required: true, secret: false },
      // The credential marker sits inside `anyOf`, not on the property — the
      // shape wren actually emits for every optional password field.
      { name: "password", label: "Password", required: false, secret: true },
    ]);
  });

  it("keeps each authentication style of a variant source", () => {
    const sources = parseSourceCatalog(
      JSON.stringify({
        bigquery: {
          variants: {
            dataset: { properties: { dataset_id: { title: "Dataset Id" } }, required: ["dataset_id"] },
            project: { properties: { billing_project_id: { title: "Billing Project Id" } }, required: ["billing_project_id"] },
          },
        },
      }),
    );
    expect(sources[0]?.variants.map((variant) => variant.name)).toEqual(["dataset", "project"]);
    expect(sources[0]?.variants[1]?.fields[0]?.name).toBe("billing_project_id");
  });

  it("labels the connection-string escape hatch as something other than a database", () => {
    const [source] = parseSourceCatalog(JSON.stringify({ connection_url: { properties: {}, required: [] } }));
    expect(source?.label).toBe("Other — connection URL");
  });

  it("rejects a document it cannot read rather than returning an empty catalog", () => {
    expect(() => parseSourceCatalog("not json")).toThrow(/did not return JSON/);
    expect(() => parseSourceCatalog("[]")).toThrow(/non-object document/);
    expect(() => parseSourceCatalog("{}")).toThrow(/listed no data sources/);
  });
});

describe("loadSourceCatalog", () => {
  it("reports whether the list came from wren, and offers more than the old hardcoded four when it did", async () => {
    resetSourceCatalogCache();
    const catalog = await loadSourceCatalog({ refresh: true });
    if (catalog.fromCli) {
      // The whole point of the change: the registry is far longer than the
      // four the picker used to ship.
      expect(catalog.sources.length).toBeGreaterThan(8);
      expect(catalog.sources.map((source) => source.key)).toContain("postgres");
      expect(catalog.degradedReason).toBeUndefined();
    } else {
      // No wren on PATH (a fresh CI runner). Degrading is allowed; degrading
      // silently is not.
      expect(catalog.sources.map((source) => source.key)).toEqual(["postgres", "bigquery", "snowflake", "duckdb"]);
      expect(catalog.degradedReason).toBeTruthy();
    }
  });

  it("keeps the offline fallback a subset of what wren really supports", async () => {
    resetSourceCatalogCache();
    const catalog = await loadSourceCatalog({ refresh: true });
    if (!catalog.fromCli) return; // nothing to compare against on a runner without wren
    const live = new Set(catalog.sources.map((source) => source.key));
    // The fallback is the last hardcoded source list left in this package. If
    // wren ever renames or drops one of these keys, the degraded path would
    // start offering a source that cannot exist — the exact failure this module
    // was written to end.
    for (const key of ["postgres", "bigquery", "snowflake", "duckdb"]) expect(live).toContain(key);
  });

  it("caches per process and refreshes on request", async () => {
    resetSourceCatalogCache();
    const first = await loadSourceCatalog();
    expect(await loadSourceCatalog()).toBe(first);
    expect(await loadSourceCatalog({ refresh: true })).not.toBe(first);
  });
});
