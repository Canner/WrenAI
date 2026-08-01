import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSetupTerminal } from "../harness/setup/runner.js";
import type { SetupTerminalContext } from "../harness/setup/runner.js";

function makeContext(name: string): SetupTerminalContext {
  const root = mkdtempSync(path.join(tmpdir(), "wren-harness-parse-setup-terminal-"));
  return { root, name };
}

function scaffold(context: SetupTerminalContext): void {
  mkdirSync(path.join(context.root, context.name), { recursive: true });
  writeFileSync(path.join(context.root, context.name, "wren_project.yml"), "name: test\n");
}

/** Everything `connect`'s prompt promises before it stops at `needs_input`: the project dir, `wren_project.yml`, and an empty `.env` template. */
function scaffoldConnect(context: SetupTerminalContext): void {
  scaffold(context);
  writeFileSync(path.join(context.root, context.name, ".env"), "POSTGRES_HOST=\n");
}

function markValidated(context: SetupTerminalContext): void {
  mkdirSync(path.join(context.root, context.name), { recursive: true });
  writeFileSync(path.join(context.root, context.name, ".wren-validated"), "");
}

/** Overwrites wren_project.yml with a `profile:`/`data_source:` pin, mirroring what `wren profile add --activate` (via `pin_profile`) writes on a successful bind. */
function scaffoldPinned(context: SetupTerminalContext, profile: string, dataSource: string): void {
  mkdirSync(path.join(context.root, context.name), { recursive: true });
  writeFileSync(path.join(context.root, context.name, "wren_project.yml"), `name: test\nprofile: ${profile}\ndata_source: ${dataSource}\n`);
}

function writeMdl(context: SetupTerminalContext, modelNames: readonly string[], measureCount = 0): void {
  const targetDir = path.join(context.root, context.name, "target");
  mkdirSync(targetDir, { recursive: true });
  const mdl = {
    catalog: "wren",
    schema: "public",
    models: modelNames.map((name) => ({ name })),
    relationships: [],
    views: [],
    cubes:
      measureCount > 0
        ? [
            {
              name: "metrics",
              baseObject: modelNames[0] ?? "missing_model",
              measures: Array.from({ length: measureCount }, (_, index) => ({ name: `measure_${index}`, expression: "COUNT(*)" })),
            },
          ]
        : [],
  };
  writeFileSync(path.join(targetDir, "mdl.json"), JSON.stringify(mdl));
}

describe("parseSetupTerminal", () => {
  it("ok + wren_project.yml present on disk -> ok, with the agent's reason preserved", () => {
    const context = makeContext("acme");
    scaffold(context);

    const result = parseSetupTerminal(
      "Scaffolded the project and wrote an empty .env template.\nSETUP_STATUS: ok - connected to postgres",
      context,
    );

    expect(result).toEqual({ status: "ok", message: "connected to postgres" });
  });

  it("ok + wren_project.yml MISSING on disk -> downgraded to error (agent self-report is not trusted blindly)", () => {
    const context = makeContext("acme");
    // Deliberately do not scaffold anything.

    const result = parseSetupTerminal("SETUP_STATUS: ok - all done", context);

    expect(result.status).toBe("error");
    expect(result.message).toContain(path.join(context.root, context.name, "wren_project.yml"));
    expect(result.message).toContain('reported "ok"');
  });

  it("needs_input + connect's promised artifacts (dir, wren_project.yml, .env) all present -> needs_input, reason preserved verbatim", () => {
    const context = makeContext("acme");
    scaffoldConnect(context);

    const result = parseSetupTerminal(
      "Wrote an empty .env template — please fill it in.\nSETUP_STATUS: needs_input - waiting for the user to fill in .env",
      context,
    );

    expect(result).toEqual({ status: "needs_input", message: "waiting for the user to fill in .env" });
  });

  describe("needs_input on the connect step is independently verified — connect's prompt promises a scaffolded dir + wren_project.yml + .env before it stops", () => {
    it("needs_input + nothing scaffolded at all -> downgraded to error, naming the missing project dir", () => {
      const context = makeContext("acme");
      // Deliberately scaffold nothing — the agent burned its turn on Preflight and stopped.

      const result = parseSetupTerminal("SETUP_STATUS: needs_input - please fill in .env", context);

      expect(result.status).toBe("error");
      expect(result.message).toContain(path.join(context.root, context.name));
      expect(result.message).toContain('reported "needs_input"');
    });

    it("needs_input + project dir exists but wren_project.yml is missing -> downgraded to error, naming wren_project.yml", () => {
      const context = makeContext("acme");
      mkdirSync(path.join(context.root, context.name), { recursive: true });

      const result = parseSetupTerminal("SETUP_STATUS: needs_input - please fill in .env", context);

      expect(result.status).toBe("error");
      expect(result.message).toContain(path.join(context.root, context.name, "wren_project.yml"));
    });

    it("needs_input + wren_project.yml exists but .env is missing -> downgraded to error, naming .env", () => {
      const context = makeContext("acme");
      scaffold(context); // wren_project.yml exists, but no .env was ever written

      const result = parseSetupTerminal("SETUP_STATUS: needs_input - please fill in .env", context);

      expect(result.status).toBe("error");
      expect(result.message).toContain(path.join(context.root, context.name, ".env"));
    });

    it("needs_input on connect_resume is NOT independently verified — connect_resume's needs_input has no promised new artifact to check", () => {
      const context = { ...makeContext("acme"), stepKey: "connect_resume" };
      // Deliberately scaffold nothing at all.

      const result = parseSetupTerminal("SETUP_STATUS: needs_input - ambiguous datasource field, please confirm", context);

      expect(result).toEqual({ status: "needs_input", message: "ambiguous datasource field, please confirm" });
    });

    it("needs_input on an UNRECOGNISED stepKey is NOT held to connect's artifact promises — allowlist, not an exclusion list", () => {
      const context = { ...makeContext("acme"), stepKey: "some_future_step" };
      // Deliberately scaffold nothing at all — an exclusion-list gate would wrongly downgrade this.

      const result = parseSetupTerminal("SETUP_STATUS: needs_input - waiting on something step-specific", context);

      expect(result).toEqual({ status: "needs_input", message: "waiting on something step-specific" });
    });
  });

  it("error -> error, reason preserved verbatim (no disk check performed for error)", () => {
    const context = makeContext("acme");

    const result = parseSetupTerminal("SETUP_STATUS: error - could not reach the database", context);

    expect(result).toEqual({ status: "error", message: "could not reach the database" });
  });

  it("missing SETUP_STATUS line entirely -> a sensible default error status/message", () => {
    const context = makeContext("acme");

    const result = parseSetupTerminal("I scaffolded the project but forgot to report a status.", context);

    expect(result.status).toBe("error");
    expect(result.message).toBe("the setup agent's final message did not contain a SETUP_STATUS line");
  });

  it("a SETUP_STATUS line with no reason text falls back to defaultMessageFor(status)", () => {
    const context = makeContext("acme");
    scaffold(context);

    const needsInputContext = makeContext("beta");
    scaffoldConnect(needsInputContext);

    expect(parseSetupTerminal("SETUP_STATUS: ok", context).message).toBe("setup completed successfully");
    expect(parseSetupTerminal("SETUP_STATUS: needs_input", needsInputContext).message).toBe("waiting for user input");
    expect(parseSetupTerminal("SETUP_STATUS: error", makeContext("gamma")).message).toBe("setup failed");
  });

  it("only the LAST SETUP_STATUS line counts — an earlier one narrated mid-plan is ignored", () => {
    const context = makeContext("acme");
    scaffold(context);

    const result = parseSetupTerminal(
      "My plan: SETUP_STATUS: error - just thinking out loud, ignore this\n" +
        "Actually everything worked.\n" +
        "SETUP_STATUS: ok - connected successfully",
      context,
    );

    expect(result).toEqual({ status: "ok", message: "connected successfully" });
  });

  it("status keyword matching is case-insensitive", () => {
    const context = makeContext("acme");
    scaffold(context);

    expect(parseSetupTerminal("setup_status: OK - done", context).status).toBe("ok");
  });

  describe("stepKey: connect_resume's ok gate checks .wren-validated, not wren_project.yml", () => {
    it("ok + wren_project.yml present but NO .wren-validated sentinel -> downgraded to error (wren_project.yml alone is vacuous on resume — it already existed from the connect turn)", () => {
      const context = { ...makeContext("acme"), stepKey: "connect_resume" };
      scaffold(context); // wren_project.yml exists, but no .wren-validated

      const result = parseSetupTerminal("SETUP_STATUS: ok - validated the connection", context);

      expect(result.status).toBe("error");
      expect(result.message).toContain(path.join(context.root, context.name, ".wren-validated"));
      expect(result.message).not.toContain("wren_project.yml");
    });

    it("ok + .wren-validated sentinel present -> ok, with the agent's reason preserved", () => {
      const context = { ...makeContext("acme"), stepKey: "connect_resume" };
      scaffold(context);
      markValidated(context);

      const result = parseSetupTerminal("SETUP_STATUS: ok - connected to postgres", context);

      expect(result).toEqual({ status: "ok", message: "connected to postgres" });
    });

    it("without stepKey (the initial connect step), wren_project.yml alone is still sufficient for ok", () => {
      const context = makeContext("acme");
      scaffold(context); // no .wren-validated, and none is expected on the connect step

      const result = parseSetupTerminal("SETUP_STATUS: ok - scaffolded", context);

      expect(result).toEqual({ status: "ok", message: "scaffolded" });
    });
  });

  describe("stepKey: connect_resume + expectedSourceType additionally checks wren_project.yml's profile/data_source pin", () => {
    it("expectedSourceType omitted (the pre-existing caller shape) -> old behavior preserved exactly, even with no profile/data_source fields on disk", () => {
      const context = { ...makeContext("acme"), stepKey: "connect_resume" };
      scaffold(context); // "name: test\n" only — no profile:/data_source: fields at all
      markValidated(context);

      const result = parseSetupTerminal("SETUP_STATUS: ok - connected to postgres", context);

      expect(result).toEqual({ status: "ok", message: "connected to postgres" });
    });

    it("expectedSourceType matches the pinned data_source -> ok, unaffected", () => {
      const context = { ...makeContext("acme"), stepKey: "connect_resume", expectedSourceType: "duckdb" };
      scaffoldPinned(context, "acme", "duckdb");
      markValidated(context);

      const result = parseSetupTerminal("SETUP_STATUS: ok - connected to duckdb", context);

      expect(result).toEqual({ status: "ok", message: "connected to duckdb" });
    });

    it("expectedSourceType matches case-insensitively / with surrounding whitespace -> ok", () => {
      const context = { ...makeContext("acme"), stepKey: "connect_resume", expectedSourceType: "DuckDB" };
      scaffoldPinned(context, "acme", "duckdb");
      markValidated(context);

      const result = parseSetupTerminal("SETUP_STATUS: ok - connected", context);

      expect(result.status).toBe("ok");
    });

    it("expectedSourceType mismatches the pinned data_source -> downgraded to error, pointing at the profile fields (not .env)", () => {
      const context = { ...makeContext("acme"), stepKey: "connect_resume", expectedSourceType: "duckdb" };
      scaffoldPinned(context, "acme", "postgres"); // agent force-repinned onto the wrong profile
      markValidated(context);

      const result = parseSetupTerminal("SETUP_STATUS: ok - connected to postgres", context);

      expect(result.status).toBe("error");
      expect(result.message).toContain("data_source: postgres");
      expect(result.message).toContain("duckdb");
      expect(result.message).toContain(path.join(context.root, context.name, "wren_project.yml"));
      // AC requires the failure to point at the profile, not .env — verified by asserting the
      // message explicitly directs the reader to the profile rather than merely omitting ".env".
      expect(result.message).toMatch(/check the profile, not \.env/i);
    });

    it("expectedSourceType set but wren_project.yml has no profile: pin at all -> downgraded to error naming the missing pin", () => {
      const context = { ...makeContext("acme"), stepKey: "connect_resume", expectedSourceType: "duckdb" };
      scaffold(context); // "name: test\n" only — the CLI's own mismatch gate never committed a pin
      markValidated(context);

      const result = parseSetupTerminal("SETUP_STATUS: ok - connected", context);

      expect(result.status).toBe("error");
      expect(result.message).toContain('no "profile:" pin');
      expect(result.message).toMatch(/check the profile, not \.env/i);
    });
  });

  describe("stepKey: 'context' checks target/mdl.json has >=1 model, not wren_project.yml/.wren-validated", () => {
    it("ok + target/mdl.json with >=1 model -> ok, with the agent's reason preserved", () => {
      const context = { ...makeContext("acme"), stepKey: "context" };
      scaffold(context);
      writeMdl(context, ["customers", "orders"], 1);

      const result = parseSetupTerminal("SETUP_STATUS: ok - built MDL with 2 models", context);

      expect(result).toEqual({ status: "ok", message: "built MDL with 2 models" });
    });

    it("ok + target/mdl.json present but models is EMPTY -> downgraded to error (self-report is not trusted)", () => {
      const context = { ...makeContext("acme"), stepKey: "context" };
      scaffold(context);
      writeMdl(context, []);

      const result = parseSetupTerminal("SETUP_STATUS: ok - built the MDL", context);

      expect(result.status).toBe("error");
      expect(result.message).toContain(path.join(context.root, context.name, "target", "mdl.json"));
      expect(result.message).toContain("0 models");
    });

    it("ok + a model but no measure -> downgraded to error", () => {
      const context = { ...makeContext("acme"), stepKey: "context" };
      scaffold(context);
      writeMdl(context, ["customers"]);

      const result = parseSetupTerminal("SETUP_STATUS: ok - built the MDL", context);

      expect(result.status).toBe("error");
      expect(result.message).toContain("0 measures");
    });

    it("a claimed success with a model and measure but no successful discovery is rejected as an agent-workflow failure", () => {
      const context = {
        ...makeContext("acme"),
        stepKey: "context",
        worklog: [
          { label: "setup_execution", input: { command: "wren skills get generate-mdl" }, detail: '{"exitCode":0,"stdout":"skill","stderr":""}' },
          { label: "setup_execution", input: { command: "wren context build" }, detail: '{"exitCode":0,"stdout":"built","stderr":""}' },
        ],
      };
      scaffold(context);
      writeMdl(context, ["customers"], 1);

      const result = parseSetupTerminal("SETUP_STATUS: ok - built MDL with 1 model and 1 measure", context);

      expect(result).toMatchObject({ status: "error", failureKind: "no_successful_schema_discovery" });
      expect(result.message).toMatch(/never completed recognized schema discovery/i);
    });

    it("a claimed success with a model and measure after successful discovery is accepted", () => {
      const context = {
        ...makeContext("acme"),
        stepKey: "context",
        worklog: [
          {
            label: "setup_execution",
            input: { command: 'wren --sql "SELECT table_name FROM information_schema.tables" -o json' },
            detail: '{"exitCode":0,"stdout":"[\\"customers\\"]","stderr":""}',
          },
        ],
      };
      scaffold(context);
      writeMdl(context, ["customers"], 1);

      expect(parseSetupTerminal("SETUP_STATUS: ok - built MDL with 1 model and 1 measure", context)).toEqual({
        status: "ok",
        message: "built MDL with 1 model and 1 measure",
      });
    });

    it("accepts subscription-mode Bash worklog evidence under the same discovery contract", () => {
      const context = {
        ...makeContext("acme"),
        stepKey: "context",
        worklog: [
          {
            label: "Bash",
            input: { command: 'wren --sql "SELECT table_name FROM information_schema.tables" -o json' },
            detail: 'Exit code: 0\nFinal output:\n[{"table_name":"customers"}]',
          },
        ],
      };
      scaffold(context);
      writeMdl(context, ["customers"], 1);

      expect(parseSetupTerminal("SETUP_STATUS: ok - built MDL with 1 model and 1 measure", context)).toEqual({
        status: "ok",
        message: "built MDL with 1 model and 1 measure",
      });
    });

    it("ok + target/mdl.json MISSING entirely -> downgraded to error", () => {
      const context = { ...makeContext("acme"), stepKey: "context" };
      scaffold(context); // wren_project.yml exists, but no target/mdl.json was ever built

      const result = parseSetupTerminal("SETUP_STATUS: ok - built the MDL", context);

      expect(result.status).toBe("error");
      expect(result.message).toContain(path.join(context.root, context.name, "target", "mdl.json"));
      expect(result.message).toContain("does not exist");
    });

    it("ok + target/mdl.json is malformed JSON -> treated as 0 models -> downgraded to error", () => {
      const context = { ...makeContext("acme"), stepKey: "context" };
      scaffold(context);
      const targetDir = path.join(context.root, context.name, "target");
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(path.join(targetDir, "mdl.json"), "{ not valid json");

      const result = parseSetupTerminal("SETUP_STATUS: ok - built the MDL", context);

      expect(result.status).toBe("error");
      expect(result.message).toContain("0 models");
    });

    it("needs_input/error for the context step still short-circuit before any disk check (same as connect/connect_resume)", () => {
      const context = { ...makeContext("acme"), stepKey: "context" };
      // Deliberately no scaffold/mdl.json at all.

      expect(parseSetupTerminal("SETUP_STATUS: needs_input - ambiguous relationship, please confirm", context)).toEqual({
        status: "needs_input",
        message: "ambiguous relationship, please confirm",
      });
      expect(parseSetupTerminal("SETUP_STATUS: error - could not connect to discover schema", context)).toEqual({
        status: "error",
        message: "could not connect to discover schema",
      });
    });
  });

  describe("stepKey: 'context', SETUP_STATUS: error — attribution depends on whether a setup_execution call actually failed", () => {
    // The exact wording the agent produced in the real failure this ticket is about: it ran
    // "wren generate-mdl" (mistaking a skill name for a CLI command, which does not exist),
    // then reported this SETUP_STATUS line — falsely blaming the connection/data source for
    // what was actually its own tool-use mistake. Both tests below feed this SAME finalText;
    // only the worklog differs, which is exactly the distinction AC#1 requires.
    const finalText =
      "SETUP_STATUS: error - schema introspection found no tables; nothing to model or build. Check connection validity and source data presence.";

    it("a failed setup_execution call in the worklog (nonzero exitCode) reframes the message as a command/tool failure, not a data-source claim — this is the falsifying case: it FAILS before the fix, since parseSetupTerminal previously had no worklog parameter at all and always returned the agent's message verbatim", () => {
      const context = {
        ...makeContext("acme"),
        stepKey: "context",
        worklog: [
          {
            label: "setup_execution",
            input: { command: "wren generate-mdl" },
            // Mirrors the real truncated-JSON shape persisted by summarizeToolOutput:
            // exitCode first (so it survives 200-char truncation), then stdout/stderr.
            detail: '{"exitCode":2,"stdout":"","stderr":"Usage: wren [OPTIONS] COMMAND [ARGS]...\\nError: No such command \'generate-mdl\'."}',
          },
        ],
      };

      const result = parseSetupTerminal(finalText, context);

      expect(result.status).toBe("error");
      expect(result.message).toContain("wren generate-mdl");
      expect(result.message).toContain("exit code 2");
      // The reframed message still quotes the agent's own report verbatim (for
      // debugging transparency), so the old wording can still appear as a quotation —
      // but the message's own leading claim must be the command/tool failure, and it
      // must explicitly disclaim treating the failure as data-source evidence.
      expect(result.message).toMatch(/^`wren generate-mdl` failed with exit code 2/);
      expect(result.message).toContain("not by itself evidence that the connection or data source lacks tables");
    });

    it("a zero-table claim with no recorded schema-introspection attempt is reframed as an agent-workflow failure, not a data-source claim", () => {
      const context = {
        ...makeContext("acme"),
        stepKey: "context",
        worklog: [
          { label: "setup_execution", input: { command: "wren skills get generate-mdl" }, detail: '{"exitCode":0,"stdout":"skill","stderr":""}' },
          { label: "setup_execution", input: { command: "wren context validate" }, detail: '{"exitCode":0,"stdout":"validated","stderr":""}' },
          { label: "setup_execution", input: { command: "wren context build" }, detail: '{"exitCode":0,"stdout":"built","stderr":""}' },
        ],
      };

      const result = parseSetupTerminal(finalText, context);

      expect(result.status).toBe("error");
      expect(result.message).toMatch(/^the agent never attempted schema introspection/i);
      expect(result.message).toContain("not evidence that the connection or data source lacks tables");
      // An absent worklog is not evidence of an absent attempt; keep the
      // optional worklog contract backward-compatible for older callers.
      expect(parseSetupTerminal(finalText, { ...makeContext("acme"), stepKey: "context" })).toEqual({
        status: "error",
        message: "schema introspection found no tables; nothing to model or build. Check connection validity and source data presence.",
      });
    });

    it.each([
      ["a Wren SQL connectivity probe", 'wren --sql "SELECT 1"'],
      ["an inline SQLAlchemy connectivity probe", 'python -c "from sqlalchemy import create_engine; create_engine(url).connect()"'],
      ["a connector-CLI connectivity probe", 'psql -c "SELECT 1"'],
    ])("%s does not count as schema introspection", (_description, command) => {
      const result = parseSetupTerminal(finalText, {
        ...makeContext("acme"),
        stepKey: "context",
        worklog: [{ label: "setup_execution", input: { command }, detail: '{"exitCode":0,"stdout":"1","stderr":""}' }],
      });

      expect(result.message).toMatch(/^the agent never attempted schema introspection/i);
    });

    it.each([
      ["a Wren information-schema query", 'wren --sql "SELECT table_name FROM information_schema.tables" -o json'],
      ["an inline SQLAlchemy table-discovery call", 'python -c "from sqlalchemy import create_engine, inspect; inspect(create_engine(url)).get_table_names()"'],
      ["a connector-CLI information-schema query", 'psql -c "SELECT table_name FROM information_schema.tables"'],
    ])("%s counts as a schema-discovery attempt", (_description, command) => {
      const result = parseSetupTerminal(finalText, {
        ...makeContext("acme"),
        stepKey: "context",
        worklog: [{ label: "setup_execution", input: { command }, detail: '{"exitCode":0,"stdout":"[]","stderr":""}' }],
      });

      expect(result.message).toBe(
        "schema introspection found no tables; nothing to model or build. Check connection validity and source data presence.",
      );
    });

    it("no attempt, an allowed introspection attempt, and a failed command produce three distinct messages for the identical zero-table claim", () => {
      const failedContext = {
        ...makeContext("acme"),
        stepKey: "context",
        worklog: [{ label: "setup_execution", input: { command: "wren generate-mdl" }, detail: '{"exitCode":2,"stdout":"","stderr":"Error: No such command \'generate-mdl\'."}' }],
      };
      const noIntrospectionContext = {
        ...makeContext("acme"),
        stepKey: "context",
        worklog: [{ label: "setup_execution", input: { command: "wren context build" }, detail: '{"exitCode":0,"stdout":"built","stderr":""}' }],
      };
      const introspectedContext = {
        ...makeContext("acme"),
        stepKey: "context",
        worklog: [
          {
            label: "setup_execution",
            input: { command: 'wren --sql "SELECT table_name FROM information_schema.tables" -o json' },
            detail: '{"exitCode":0,"stdout":"[]","stderr":""}',
          },
        ],
      };

      const failedResult = parseSetupTerminal(finalText, failedContext);
      const noIntrospectionResult = parseSetupTerminal(finalText, noIntrospectionContext);
      const introspectedResult = parseSetupTerminal(finalText, introspectedContext);

      expect(failedResult.status).toBe("error");
      expect(noIntrospectionResult.status).toBe("error");
      expect(introspectedResult.status).toBe("error");
      expect(noIntrospectionResult.message).toMatch(/^the agent never attempted schema introspection/i);
      expect(introspectedResult.message).toBe(
        "schema introspection found no tables; nothing to model or build. Check connection validity and source data presence.",
      );
      expect(new Set([failedResult.message, noIntrospectionResult.message, introspectedResult.message]).size).toBe(3);
    });
  });
});
