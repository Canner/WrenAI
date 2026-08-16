/**
 * Provisioning exists so that picking one of the twenty-one sources wren
 * supports does not fail deep in the connect turn with a bare
 * `ModuleNotFoundError`. These tests pin the mapping (which extra a source's
 * driver ships under), that provisioning is reported truthfully, and — most
 * importantly — that a failure to provision is never described to the agent as
 * success. The prompt used to assert the driver was "already available"; the
 * agent can disprove that in one command.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { driverExtraFor, driverProvisionNote, provisionSourceDriver } from "../server/source-driver.js";

const ok = (stdout: string) => async () => ({ stdout, stderr: "", error: null });

describe("driverExtraFor", () => {
  it("maps a source to the extra its driver ships under", () => {
    expect(driverExtraFor("postgres")).toBe("postgres");
    expect(driverExtraFor("oracle")).toBe("oracle");
  });

  it("follows wren's aliases for connectors that reuse another driver", () => {
    // wren routes doris through its mysql connector and canner through psycopg.
    expect(driverExtraFor("doris")).toBe("mysql");
    expect(driverExtraFor("canner")).toBe("postgres");
  });

  it("asks for nothing for the sources whose dependencies are core", () => {
    // wren's own _INSTALL_EXTRA points the file sources at a "duckdb" extra that
    // its pyproject does not declare. Requesting it would be a silent no-op that
    // reads like a successful install, so these are explicitly "no extra".
    for (const key of ["duckdb", "local_file", "s3_file", "minio_file", "gcs_file", "datafusion"]) {
      expect(driverExtraFor(key)).toBeUndefined();
    }
  });

  it("asks for nothing for a key wren has no driver extra for", () => {
    expect(driverExtraFor("connection_url")).toBeUndefined();
    expect(driverExtraFor("not_a_source")).toBeUndefined();
  });
});

describe("drift against wren's own packaging", () => {
  // The extra names live here because the BFF must know them before running
  // anything, but wren owns them. If wren renames or drops one, this fails
  // rather than letting provisioning silently no-op and the connect turn die on
  // an import error — the failure mode this module exists to remove.
  it("only names driver extras wren actually declares", async () => {
    const pyproject = new URL("../../../core/wren/pyproject.toml", import.meta.url);
    let text: string;
    try {
      text = await readFile(pyproject, "utf-8");
    } catch {
      return; // wren source not present (published package layout) — nothing to compare
    }
    const section = /\[project\.optional-dependencies\]([\s\S]*?)(\n\[|$)/.exec(text);
    expect(section).not.toBeNull();
    const declared = new Set([...section![1]!.matchAll(/^([a-z0-9_-]+)\s*=/gm)].map((match) => match[1]!));
    for (const source of ["postgres", "mysql", "bigquery", "snowflake", "clickhouse", "trino", "mssql", "databricks", "redshift", "spark", "athena", "oracle", "doris", "canner"]) {
      const extra = driverExtraFor(source);
      expect(extra, `${source} should map to a declared extra`).toBeDefined();
      expect(declared, `wren no longer declares the "${extra}" extra`).toContain(extra!);
    }
    // And the converse: a source we claim needs nothing must genuinely have no
    // extra to install.
    for (const source of ["duckdb", "local_file", "datafusion"]) {
      expect(declared.has(source)).toBe(false);
    }
  });
});

describe("provisionSourceDriver", () => {
  it("skips sources that need no extra without shelling out", async () => {
    let called = false;
    const result = await provisionSourceDriver("duckdb", {
      run: async () => {
        called = true;
        return { stdout: "", stderr: "", error: null };
      },
    });
    expect(result).toEqual({ status: "not_needed" });
    expect(called).toBe(false);
  });

  it("reports an install that changed the environment", async () => {
    const result = await provisionSourceDriver("postgres", { run: ok(" + psycopg==3.3.4\n + psycopg-binary==3.3.4\n") });
    // Skipped when this machine has no wren on PATH; the mapping is covered above.
    if (result.status === "unavailable") return;
    expect(result).toMatchObject({ status: "installed", extra: "postgres" });
  });

  it("reports an already-satisfied extra as ready, not as an install", async () => {
    const result = await provisionSourceDriver("postgres", { run: ok("Audited 1 package in 3ms\n") });
    if (result.status === "unavailable") return;
    expect(result).toMatchObject({ status: "ready", extra: "postgres" });
  });

  it("reports a failed install as failed rather than swallowing it", async () => {
    const result = await provisionSourceDriver("oracle", {
      run: async () => ({ stdout: "", stderr: "No solution found", error: Object.assign(new Error("exit 1"), { code: "1" }) as NodeJS.ErrnoException }),
    });
    if (result.status === "unavailable") return;
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("No solution found");
  });

  it("reports a missing uv as unavailable, not as a driver problem", async () => {
    const result = await provisionSourceDriver("trino", {
      run: async () => ({ stdout: "", stderr: "", error: Object.assign(new Error("spawn uv ENOENT"), { code: "ENOENT" }) as NodeJS.ErrnoException }),
    });
    if (result.status === "unavailable" && result.detail?.includes("interpreter")) return; // no wren on PATH
    expect(result).toMatchObject({ status: "unavailable", extra: "trino" });
    expect(result.detail).toContain("uv is not on PATH");
  });
});

describe("driverProvisionNote", () => {
  it("never tells the agent a driver is available when provisioning did not succeed", () => {
    for (const status of ["failed", "unavailable"] as const) {
      const note = driverProvisionNote("postgres", { status, extra: "postgres", detail: "boom" });
      expect(note).toContain("could NOT be provisioned");
      expect(note).toContain("boom");
      // The claim that broke this before, in its various shapes.
      expect(note).not.toMatch(/already available|nothing to install|is present/);
    }
  });

  it("states plainly what was done when it did succeed", () => {
    expect(driverProvisionNote("postgres", { status: "installed", extra: "postgres" })).toContain("was just installed");
    expect(driverProvisionNote("postgres", { status: "ready", extra: "postgres" })).toContain("is present");
    expect(driverProvisionNote("duckdb", { status: "not_needed" })).toContain("needs no optional driver");
  });
});
