import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { NativeWrenRuntime } from "./native-wren-runtime.js";
import { buildNativeChildEnvironment, nativeProcessEnvironment } from "./native-runtime-spec.js";
import { InteractiveLaunchError } from "./native-session-workspace.js";

const MATERIALIZE_WREN_HOME_SCRIPT = String.raw`
import json
import os
import pathlib
import re
import sys
import yaml
from dotenv import dotenv_values
from wren.profile import resolve_profile_for_project

project = pathlib.Path(sys.argv[1]).resolve(strict=True)
destination = pathlib.Path(sys.argv[2])
source_home = pathlib.Path(sys.argv[3]).resolve(strict=True)

def regular(path, required=True):
    if not path.exists():
        if required:
            raise SystemExit(2)
        return None
    if path.is_symlink() or not path.is_file() or path.resolve(strict=True) != path:
        raise SystemExit(3)
    return path

regular(project / "wren_project.yml")
regular(source_home / "profiles.yml")
name, profile = resolve_profile_for_project(project, strict=True)
if not name or not isinstance(profile, dict):
    raise SystemExit(4)

pattern = re.compile(r"\$\{([_A-Z][_A-Z0-9]*)\}")
keys = set()
def collect(value):
    if isinstance(value, str):
        keys.update(pattern.findall(value))
    elif isinstance(value, dict):
        for item in value.values(): collect(item)
    elif isinstance(value, list):
        for item in value: collect(item)
collect(profile)

project_env_path = regular(project / ".env", required=False)
home_env_path = regular(source_home / ".env", required=False)
project_values = dotenv_values(project_env_path) if project_env_path else {}
home_values = dotenv_values(home_env_path) if home_env_path else {}
selected = {}
for key in sorted(keys):
    value = project_values.get(key)
    if value is None:
        value = home_values.get(key)
    if value is None:
        raise SystemExit(5)
    selected[key] = str(value)

def expand(value):
    if isinstance(value, str):
        return pattern.sub(lambda match: selected[match.group(1)], value)
    if isinstance(value, dict):
        return {key: expand(item) for key, item in value.items()}
    if isinstance(value, list):
        return [expand(item) for item in value]
    return value

destination.mkdir(mode=0o700, parents=False, exist_ok=False)
os.chmod(destination, 0o700)
def private_write(path, content):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(content)
    os.chmod(path, 0o600)

profile_path = destination / "profiles.yml"
private_write(profile_path, yaml.safe_dump({"active": name, "profiles": {name: profile}}, sort_keys=False))
if selected:
    session_env = destination / ".env"
    private_write(session_env, "".join(f"{key}={json.dumps(value)}\n" for key, value in selected.items()))

expanded = expand(profile)
data_source = expanded.get("datasource")
data_root = None
if data_source in ("duckdb", "local_file"):
    data_root = expanded.get("url")
elif data_source == "datafusion":
    data_root = expanded.get("source")
if data_root:
    root = pathlib.Path(data_root).expanduser()
    if not root.is_absolute():
        root = project / root
    print(root.resolve(strict=True))
`;

export interface CodexWrenHome {
  readonly home: string;
  readonly dataRoots: readonly string[];
  readonly active?: () => boolean;
  readonly assertActive?: () => void;
  readonly cleanup?: () => void;
}

interface PrivatePathIdentity {
  readonly canonical: string;
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
}

interface PrivateFileIdentity extends PrivatePathIdentity {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly digest: string;
}

interface WrenHomeIdentity {
  readonly directory: PrivatePathIdentity;
  readonly files: Readonly<Record<string, PrivateFileIdentity>>;
}

function unavailable(): never {
  throw new InteractiveLaunchError("native Wren session home is unavailable");
}

function privateDirectoryIdentity(directory: string): PrivatePathIdentity {
  try {
    const metadata = lstatSync(directory);
    const canonical = realpathSync(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || canonical !== directory || (metadata.mode & 0o777) !== 0o700) return unavailable();
    return { canonical, dev: metadata.dev, ino: metadata.ino, mode: metadata.mode & 0o777 };
  } catch (error) {
    if (error instanceof InteractiveLaunchError) throw error;
    return unavailable();
  }
}

function privateFileIdentity(file: string): PrivateFileIdentity {
  try {
    const metadata = lstatSync(file);
    const canonical = realpathSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || canonical !== file || (metadata.mode & 0o777) !== 0o600) return unavailable();
    return {
      canonical,
      dev: metadata.dev,
      ino: metadata.ino,
      mode: metadata.mode & 0o777,
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
      ctimeMs: metadata.ctimeMs,
      digest: createHash("sha256").update(readFileSync(file)).digest("hex"),
    };
  } catch (error) {
    if (error instanceof InteractiveLaunchError) throw error;
    return unavailable();
  }
}

function samePathIdentity(left: PrivatePathIdentity, right: PrivatePathIdentity): boolean {
  return left.canonical === right.canonical && left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function sameFileIdentity(left: PrivateFileIdentity, right: PrivateFileIdentity): boolean {
  return samePathIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.digest === right.digest;
}

function captureWrenHome(destination: string, fileNames: readonly string[]): WrenHomeIdentity {
  try {
    const actualNames = readdirSync(destination).sort();
    const expectedNames = [...fileNames].sort();
    if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) return unavailable();
    return {
      directory: privateDirectoryIdentity(destination),
      files: Object.freeze(Object.fromEntries(expectedNames.map((name) => [name, privateFileIdentity(path.join(destination, name))]))),
    };
  } catch (error) {
    if (error instanceof InteractiveLaunchError) throw error;
    return unavailable();
  }
}

function assertWrenHome(destination: string, expected: WrenHomeIdentity): void {
  const current = captureWrenHome(destination, Object.keys(expected.files));
  if (!samePathIdentity(current.directory, expected.directory)) return unavailable();
  for (const [name, identity] of Object.entries(expected.files)) {
    const observed = current.files[name];
    if (!observed || !sameFileIdentity(observed, identity)) return unavailable();
  }
}

function retirementMarker(cwd: string): string {
  return path.join(cwd, ".wren-retired");
}

function retire(destination: string, marker: string): void {
  rmSync(destination, { recursive: true, force: true });
  writeFileSync(marker, "retired\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  privateFileIdentity(marker);
}

/** Setup has no bound profile yet, but still receives a fresh private WREN_HOME. */
export function createEmptyCodexWrenHome(cwd: string): CodexWrenHome {
  const destination = path.join(cwd, ".wren");
  const marker = retirementMarker(cwd);
  let active = false;
  try {
    if (existsSync(marker)) throw new Error("retired");
    mkdirSync(destination, { mode: 0o700 });
    chmodSync(destination, 0o700);
    const identity = captureWrenHome(destination, []);
    active = true;
    return Object.freeze({
      home: destination,
      dataRoots: Object.freeze([]),
      active: () => active,
      assertActive: () => {
        if (!active) return unavailable();
        assertWrenHome(destination, identity);
      },
      cleanup: () => {
        if (!active) return;
        active = false;
        retire(destination, marker);
      },
    });
  } catch {
    rmSync(destination, { recursive: true, force: true });
    throw new InteractiveLaunchError("native Wren session home is unavailable");
  }
}

export function materializeCodexWrenHome(input: {
  readonly runtime: NativeWrenRuntime;
  readonly projectPath: string;
  readonly cwd: string;
  readonly sourceWrenHome: string;
  readonly home: string;
  readonly toolDirectories: readonly string[];
}): CodexWrenHome {
  const destination = path.join(input.cwd, ".wren");
  const marker = retirementMarker(input.cwd);
  let active = false;
  try {
    if (existsSync(marker)) throw new Error("retired");
    const environment = buildNativeChildEnvironment({
      toolDirectories: input.toolDirectories,
      home: input.home,
      projectPath: input.projectPath,
      wrenHome: input.sourceWrenHome,
      python: true,
    });
    const output = execFileSync(input.runtime.venv_python, ["-c", MATERIALIZE_WREN_HOME_SCRIPT, input.projectPath, destination, input.sourceWrenHome], {
      cwd: input.projectPath,
      env: nativeProcessEnvironment(environment),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
    const envFile = path.join(destination, ".env");
    const identity = captureWrenHome(destination, ["profiles.yml", ...(existsSync(envFile) ? [".env"] : [])]);
    active = true;
    const assertActive = () => {
      if (!active) return unavailable();
      assertWrenHome(destination, identity);
    };
    return Object.freeze({
      home: destination,
      dataRoots: Object.freeze(output.trim() ? [output.trim()] : []),
      active: () => active,
      assertActive,
      cleanup: () => {
        if (!active) return;
        active = false;
        retire(destination, marker);
      },
    });
  } catch {
    active = false;
    rmSync(destination, { recursive: true, force: true });
    throw new InteractiveLaunchError("native Wren project profile is unavailable");
  }
}
