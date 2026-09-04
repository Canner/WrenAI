import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { materializeCodexWrenHome } from "../server/native-wren-home.js";
import { resolveNativeWrenRuntime } from "../server/native-wren-runtime.js";

const roots: string[] = [];

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "genbi-session-home-")));
  roots.push(root);
  const project = path.join(root, "project");
  const sourceWrenHome = path.join(root, "source-wren-home");
  const session = path.join(root, "session");
  const data = path.join(project, "selected.duckdb");
  for (const directory of [project, sourceWrenHome, session]) mkdirSync(directory, { mode: 0o700 });
  writeFileSync(data, "fixture");
  writeFileSync(path.join(project, "wren_project.yml"), "name: fixture\ndata_source: duckdb\nprofile: selected\n");
  writeFileSync(path.join(sourceWrenHome, "profiles.yml"), [
    "active: other",
    "profiles:",
    "  selected:",
    "    datasource: duckdb",
    "    url: ${DB_FILE}",
    "    token: ${PROJECT_SECRET}",
    "    fallback: ${HOME_SECRET}",
    "  other:",
    "    datasource: postgres",
    "    password: ${UNRELATED_HOME}",
    "",
  ].join("\n"));
  writeFileSync(path.join(project, ".env"), `DB_FILE=${data}\nPROJECT_SECRET=from-project\nUNRELATED_PROJECT=do-not-copy\n`);
  writeFileSync(path.join(sourceWrenHome, ".env"), `DB_FILE=/wrong.duckdb\nHOME_SECRET=from-home\nUNRELATED_HOME=do-not-copy\n`);
  return { root, project, sourceWrenHome, session, data };
}

afterEach(() => {
  vi.unstubAllEnvs();
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function materialize(value: ReturnType<typeof fixture>, session = value.session, sourceWrenHome = value.sourceWrenHome) {
  const runtime = resolveNativeWrenRuntime();
  return materializeCodexWrenHome({
    runtime,
    projectPath: value.project,
    cwd: session,
    sourceWrenHome,
    home: realpathSync(homedir()),
    toolDirectories: [path.dirname(runtime.venv_python), path.dirname(runtime.interpreter)],
  });
}

describe("Codex session WREN_HOME", () => {
  it("materializes exactly the pinned profile and referenced secrets with private modes, then retires the home", () => {
    const value = fixture();
    const poisonedDefaultHome = path.join(value.root, "poisoned-default-wren-home");
    const poisonedSession = path.join(value.root, "poisoned-session");
    const poisonedData = path.join(value.root, "poisoned.duckdb");
    mkdirSync(poisonedDefaultHome, { mode: 0o700 });
    mkdirSync(poisonedSession, { mode: 0o700 });
    writeFileSync(poisonedData, "poisoned");
    writeFileSync(path.join(poisonedDefaultHome, "profiles.yml"), "active: selected\nprofiles:\n  selected:\n    datasource: duckdb\n    url: ${POISONED_DB}\n");
    writeFileSync(path.join(poisonedDefaultHome, ".env"), `POISONED_DB=${poisonedData}\n`);
    vi.stubEnv("DB_FILE", "/ambient-wrong.duckdb");
    vi.stubEnv("PROJECT_SECRET", "ambient-wrong");
    vi.stubEnv("HOME_SECRET", "ambient-wrong");
    vi.stubEnv("WREN_HOME", poisonedDefaultHome);

    // Positive control: the poisoned default home is a valid, operational
    // profile source and would select a different database if admitted.
    const poisoned = materialize(value, poisonedSession, poisonedDefaultHome);
    expect(poisoned.dataRoots).toEqual([realpathSync(poisonedData)]);
    poisoned.cleanup?.();

    const home = materialize(value);
    expect(home.dataRoots).toEqual([realpathSync(value.data)]);
    expect(statSync(home.home).mode & 0o777).toBe(0o700);
    expect(lstatSync(home.home).isSymbolicLink()).toBe(false);
    const profilePath = path.join(home.home, "profiles.yml");
    const envPath = path.join(home.home, ".env");
    expect(statSync(profilePath).mode & 0o777).toBe(0o600);
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    expect(lstatSync(profilePath).isSymbolicLink()).toBe(false);
    expect(lstatSync(envPath).isSymbolicLink()).toBe(false);
    const profile = readFileSync(profilePath, "utf8");
    expect(profile).toContain("active: selected");
    expect(profile).toContain("selected:");
    expect(profile).not.toContain("other:");
    const secrets = readFileSync(envPath, "utf8");
    expect(secrets).toContain(`DB_FILE=${JSON.stringify(value.data)}`);
    expect(secrets).toContain(`PROJECT_SECRET=${JSON.stringify("from-project")}`);
    expect(secrets).toContain(`HOME_SECRET=${JSON.stringify("from-home")}`);
    expect(secrets).not.toMatch(/UNRELATED|ambient-wrong|wrong\.duckdb/);

    expect(home.active?.()).toBe(true);
    home.cleanup?.();
    expect(existsSync(home.home)).toBe(false);
    expect(statSync(path.join(value.session, ".wren-retired")).mode & 0o777).toBe(0o600);
    expect(() => home.assertActive?.()).toThrow(/unavailable/);
    expect(() => materialize(value)).toThrow(/profile is unavailable/);
  });

  it("proves a regular secret file succeeds, then rejects a symlink and a missing referenced secret", () => {
    const value = fixture();
    const positiveSession = path.join(value.root, "positive-session");
    mkdirSync(positiveSession, { mode: 0o700 });
    const positive = materialize(value, positiveSession);
    expect(readFileSync(path.join(positive.home, ".env"), "utf8")).toContain("PROJECT_SECRET");
    positive.cleanup?.();

    const linkedSource = path.join(value.root, "linked-source-wren-home");
    const linkedSession = path.join(value.root, "linked-session");
    symlinkSync(value.sourceWrenHome, linkedSource, "dir");
    mkdirSync(linkedSession, { mode: 0o700 });
    expect(realpathSync(linkedSource)).toBe(value.sourceWrenHome);
    expect(() => materialize(value, linkedSession, linkedSource)).toThrow(/profile is unavailable/);
    expect(existsSync(path.join(linkedSession, ".wren"))).toBe(false);

    const external = path.join(value.root, "external.env");
    writeFileSync(external, readFileSync(path.join(value.project, ".env")));
    rmSync(path.join(value.project, ".env"));
    symlinkSync(external, path.join(value.project, ".env"));
    expect(() => materialize(value)).toThrow(/profile is unavailable/);
    expect(existsSync(path.join(value.session, ".wren"))).toBe(false);

    rmSync(path.join(value.project, ".env"));
    writeFileSync(path.join(value.project, ".env"), `DB_FILE=${value.data}\nPROJECT_SECRET=from-project\n`);
    rmSync(path.join(value.sourceWrenHome, ".env"));
    expect(() => materialize(value)).toThrow(/profile is unavailable/);
    expect(existsSync(path.join(value.session, ".wren"))).toBe(false);
  });

  it.each(["symlink", "directory", "mode", "profile", "secrets"] as const)(
    "rejects retained session-home %s replacement or tampering",
    (mutation) => {
      const value = fixture();
      const home = materialize(value);
      const destination = home.home;
      if (mutation === "symlink") {
        const replacement = path.join(value.root, "replacement-home");
        mkdirSync(replacement, { mode: 0o700 });
        rmSync(destination, { recursive: true });
        symlinkSync(replacement, destination, "dir");
      } else if (mutation === "directory") {
        rmSync(destination, { recursive: true });
        mkdirSync(destination, { mode: 0o700 });
        writeFileSync(path.join(destination, "profiles.yml"), "active: replacement\n", { mode: 0o600 });
        writeFileSync(path.join(destination, ".env"), "DB_FILE=replacement\n", { mode: 0o600 });
      } else if (mutation === "mode") {
        chmodSync(destination, 0o755);
      } else if (mutation === "profile") {
        writeFileSync(path.join(destination, "profiles.yml"), "active: replacement\n");
      } else {
        writeFileSync(path.join(destination, ".env"), "DB_FILE=replacement\n");
      }

      expect(() => home.assertActive?.()).toThrow("native Wren session home is unavailable");
      home.cleanup?.();
    },
  );
});
