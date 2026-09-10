import { lstatSync, realpathSync, existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertNativeRuntimeSpec, type NativeRuntimeSpec } from "../native-runtime-spec.js";
import type { ManagedWrenRuntimeRecord } from "../managed-wren-runtime.js";
import type { CodexWrenHome } from "../native-wren-home.js";
import { CodexRpcError } from "./codex-rpc.js";

export const CODEX_PERMISSION_PROFILE = "genbi-scoped";
export interface CodexSessionPolicy {
  readonly cwd: string;
  readonly codexHome: string;
  readonly profile: typeof CODEX_PERMISSION_PROFILE;
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly commandEnvironment: Readonly<Record<string, string | null>>;
  readonly configuration: Readonly<Record<string, unknown>>;
}
const deny = (): never => { throw new CodexRpcError("protocol"); };
const within = (root: string, target: string) => target === root || target.startsWith(root + path.sep);
function canonical(value: string): string {
  if (!path.isAbsolute(value) || realpathSync(value) !== value || lstatSync(value).isSymbolicLink()) deny();
  // Permission keys interpret globs and ~, so never treat these as literal paths.
  if (/[\x00-\x1f*?\[\]{}~]/.test(value)) deny();
  return value;
}
function privateDirectory(value: string): void {
  canonical(value);
  const stat = lstatSync(value);
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700) deny();
}
function toml(value: unknown): string {
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(toml).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${toml(item)}`).join(",")}}`;
  return deny();
}

/** Pure, resolve-only policy construction from host-owned scope, never request JSON. */
export function buildCodexSessionPolicy(spec: NativeRuntimeSpec, runtime: ManagedWrenRuntimeRecord, home: CodexWrenHome): CodexSessionPolicy {
  assertNativeRuntimeSpec(spec);
  if (spec.backend !== "codex-app-server" || spec.vendor !== "codex" || !spec.childEnvironment.CODEX_HOME || spec.mcp) deny();
  if (spec.executables.wren?.executable !== runtime.launcher || spec.executables.python?.executable !== runtime.venv_python) deny();
  if (spec.sessionWrenHome !== home.home || !home.assertActive || !home.active?.()) deny();
  home.assertActive!();
  const codexHome = canonical(spec.childEnvironment.CODEX_HOME!);
  const cwd = canonical(spec.workspace);
  const generation = canonical(runtime.generation_root);
  privateDirectory(codexHome); privateDirectory(spec.childEnvironment.HOME); privateDirectory(home.home);
  // Login belongs to the user. Never copy it or read its contents; require a
  // dedicated externally authenticated home, outside every writable/read root.
  if (codexHome === path.join(os.homedir(), ".codex") || spec.childEnvironment.HOME === os.homedir()) deny();
  const auth = path.join(codexHome, "auth.json");
  const authStat = lstatSync(auth);
  if (!authStat.isFile() || authStat.isSymbolicLink() || (authStat.mode & 0o077) !== 0) deny();
  // No operator config, plugins, hooks, or project config may augment this
  // backend. Auth and vendor-generated session state may remain in the home.
  for (const name of ["config.toml", "requirements.toml", "AGENTS.md", "instructions.md", "hooks.json", "plugins"]) {
    if (existsSync(path.join(codexHome, name))) deny();
  }
  // Codex seeds its bundled .system skills during initialization. Permit only
  // that namespace; user skills still cannot enter through the login home.
  const skills = path.join(codexHome, "skills");
  if (existsSync(skills)) {
    canonical(skills);
    if (!lstatSync(skills).isDirectory() || readdirSync(skills).some((name) => name !== ".system")) deny();
    if (existsSync(path.join(skills, ".system"))) canonical(path.join(skills, ".system"));
  }
  for (const root of [cwd, ...(spec.project ? [spec.project.path] : [])]) {
    let current = root;
    while (true) {
      if (existsSync(path.join(current, ".codex"))) deny();
      const parent = path.dirname(current); if (current === parent) break; current = parent;
    }
  }
  const readRoots = [...new Set([generation, ...spec.toolDirectories, ...(spec.project ? [spec.project.path] : []), ...home.dataRoots])].map(canonical);
  if (within(cwd, generation) || within(generation, cwd) || within(cwd, codexHome) || within(codexHome, cwd)) deny();
  for (const root of readRoots) {
    if (root === path.parse(root).root || within(root, os.homedir()) || within(root, codexHome) || within(codexHome, root)) deny();
  }
  const filesystem: Record<string, unknown> = { ":minimal": "read" };
  for (const root of readRoots) filesystem[root] = "read";
  filesystem[cwd] = "write";
  // A selected Wren profile is readable, never editable by the agent. Narrow
  // session secrets are deliberate; user/project .env remains protected.
  filesystem[home.home] = "read";
  filesystem[codexHome] = "deny";
  filesystem[path.join(os.homedir(), ".ssh")] = "deny";
  filesystem[path.join(os.homedir(), ".aws")] = "deny";
  filesystem[path.join(os.homedir(), ".codex")] = "deny";
  filesystem[path.join(os.homedir(), ".claude")] = "deny";
  if (spec.project) filesystem[path.join(spec.project.path, ".env")] = "deny";
  filesystem[path.join(cwd, ".codex")] = "deny";
  filesystem[path.join(cwd, ".git")] = "read";
  const environment: Record<string, string> = {
    PATH: spec.childEnvironment.PATH, HOME: spec.childEnvironment.HOME,
    CODEX_HOME: codexHome, TERM: "xterm-256color", COLORTERM: "truecolor",
    PYTHONNOUSERSITE: "1", PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1",
    WREN_HOME: home.home,
    ...(spec.project ? { WREN_PROJECT_HOME: spec.project.path } : {}),
  };
  // App-server may read its login; commands receive neither its home variable
  // nor any provider credentials. No ambient environment spread is used.
  const { CODEX_HOME: _loginHome, ...shellEnvironment } = environment;
  const config: Record<string, unknown> = {
    default_permissions: CODEX_PERMISSION_PROFILE,
    permissions: { [CODEX_PERMISSION_PROFILE]: { filesystem, network: { enabled: false } } },
    approval_policy: "never",
    shell_environment_policy: { inherit: "none", set: shellEnvironment },
    project_doc_max_bytes: 0,
    project_root_markers: [], web_search: "disabled", mcp_servers: {},
    features: Object.fromEntries([
      "apps", "browser_use", "browser_use_external", "browser_use_full_cdp_access", "computer_use",
      "code_mode_host", "code_mode", "code_mode_only", "hooks", "image_generation", "in_app_browser",
      "multi_agent", "multi_agent_v2", "plugins", "remote_plugin", "plugin_sharing", "skill_mcp_dependency_install",
      "skill_search", "tool_suggest", "workspace_dependencies", "request_permissions_tool", "exec_permission_approvals",
      "guardian_approval", "guardianv2", "goals", "memories", "external_agent_memory_import", "realtime_conversation",
      "shell_snapshot", "standalone_web_search",
    ].map((name) => [name, false])),
  };
  const args = Object.entries(config).flatMap(([key, value]) => ["-c", `${key}=${toml(value)}`]);
  args.push("app-server", "--stdio", "--strict-config");
  return Object.freeze({ cwd, codexHome, profile: CODEX_PERMISSION_PROFILE, args: Object.freeze(args),
    environment: Object.freeze(environment), commandEnvironment: Object.freeze({ ...shellEnvironment, CODEX_HOME: null }), configuration: Object.freeze(config) });
}
