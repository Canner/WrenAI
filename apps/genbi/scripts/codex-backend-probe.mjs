#!/usr/bin/env node
// Deterministic, unauthenticated verification of the compiled production driver.
// Synthetic Wren identities are fixtures, never a managed-runtime approval.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { attestNativeExecutable, buildNativeRuntimeSpec } from "../dist-server/server/native-runtime-spec.js";
import { createEmptyCodexWrenHome } from "../dist-server/server/native-wren-home.js";
import { buildCodexSessionPolicy } from "../dist-server/server/runtime-host/codex-policy.js";
import { spawnCodexTransport } from "../dist-server/server/runtime-host/codex-process.js";
import { CodexSession } from "../dist-server/server/runtime-host/codex-session.js";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("darwin-arm64 required");
if (!process.env.CODEX_BIN || !path.isAbsolute(process.env.CODEX_BIN)) throw new Error("absolute CODEX_BIN required");
const codex = realpathSync(process.env.CODEX_BIN);
assert.equal(execFileSync(codex, ["--version"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } }).trim(), "codex-cli 0.146.0");
const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "genbi-codex-backend-")));
const dir = (name) => { const target = path.join(root, name); mkdirSync(target, { recursive: true, mode: 0o700 }); return target; };
const workspace = dir("workspace"), login = dir("login"), home = dir("home"), generation = dir("runtime"), bin = dir("runtime/bin");
writeFileSync(path.join(login, "auth.json"), "{}", { mode: 0o600 }); // no real credential is read or copied
const secret = path.join(root, "denied.txt"); writeFileSync(secret, "outside\n");
const readable = path.join(workspace, "readable.txt"); writeFileSync(readable, "inside\n");
copyFileSync("/bin/echo", path.join(bin, "wren")); copyFileSync("/bin/echo", path.join(bin, "python"));
const identities = [attestNativeExecutable("vendor", codex), attestNativeExecutable("producer", "/bin/echo"), attestNativeExecutable("wren", path.join(bin, "wren")), attestNativeExecutable("python", path.join(bin, "python"))];
const wrenHome = createEmptyCodexWrenHome(workspace);
const spec = buildNativeRuntimeSpec({ backend: "codex-app-server", vendor: "codex", workspace, home, codexHome: login, sessionWrenHome: wrenHome.home, executables: identities, toolDirectories: [bin, "/usr/bin", "/bin"] });
const runtime = { launcher: path.join(bin, "wren"), venv_python: path.join(bin, "python"), generation_root: generation };
const policy = buildCodexSessionPolicy(spec, runtime, wrenHome);
let session;
const output = new Map();
const server = createServer((_req, res) => { res.end("network-ok"); });
const checks = [];
const childPids = new Set();
const check = (name, value) => { assert.ok(value, name); checks.push(name); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } };
async function waitFor(predicate) {
  const deadline = Date.now() + 4_000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(predicate(), "bounded lifecycle condition");
}
async function run(command, extra = {}) {
  const handle = session.startCommand({ command, timeoutMs: 5_000, ...extra });
  const result = await handle.completed;
  return { ...result, text: output.get(handle.id) ?? "" };
}
async function host(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { env: { PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "pipe"] });
    let text = ""; child.stdout.on("data", (chunk) => { text += chunk; }); child.stderr.on("data", (chunk) => { text += chunk; });
    child.on("error", reject); child.on("close", (exitCode) => resolve({ exitCode, text }));
  });
}
try {
  session = await CodexSession.connect(spawnCodexTransport({ executable: codex, args: policy.args, cwd: workspace, env: policy.environment }), policy,
    () => { assert.deepEqual(buildCodexSessionPolicy(spec, runtime, wrenHome), policy); },
    (event) => { if (event.method === "command/exec/outputDelta") output.set(event.params.processId, (output.get(event.params.processId) ?? "") + Buffer.from(event.params.deltaBase64, "base64").toString()); });
  check("named profile permits workspace read", (await run(["/bin/cat", readable])).text === "inside\n");
  check("outside-read positive control", (await host(["/bin/cat", secret])).text === "outside\n");
  const denied = await run(["/bin/cat", secret]);
  check("named profile denies outside read for permission reason", denied.exitCode !== 0 && /operation not permitted|permission denied/i.test(denied.text));
  const descendantRead = await run(["/bin/sh", "-c", '/bin/cat "$1"; status=$?; if [ "$status" != 0 ]; then exit 23; fi', "probe", secret]);
  check("read denial is inherited by a shell child", descendantRead.exitCode === 23 && /operation not permitted|permission denied/i.test(descendantRead.text));
  const auth = await run(["/bin/cat", path.join(login, "auth.json")]);
  check("vendor home is not command-readable", auth.exitCode !== 0 && /operation not permitted|permission denied/i.test(auth.text));
  const insideWrite = await run(["/bin/sh", "-c", 'printf written > "$1"', "probe", path.join(workspace, "written")]);
  check("workspace write succeeds", insideWrite.exitCode === 0 && readFileSync(path.join(workspace, "written"), "utf8") === "written");
  const outsideWrite = await run(["/bin/sh", "-c", 'printf poison > "$1"', "probe", secret]);
  check("outside write is denied and unchanged", outsideWrite.exitCode !== 0 && readFileSync(secret, "utf8") === "outside\n");
  const managedFile = path.join(generation, "immutable"); writeFileSync(managedFile, "managed");
  const managedWrite = await run(["/bin/sh", "-c", 'printf poison > "$1"', "probe", managedFile]);
  check("managed generation remains read-only", managedWrite.exitCode !== 0 && readFileSync(managedFile, "utf8") === "managed");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const networkCommand = ["/bin/sh", "-c", '/usr/bin/curl --noproxy "*" --silent --show-error --max-time 3 "$1"; status=$?; if [ "$status" = 7 ]; then exit 23; fi; exit "$status"', "probe", url];
  const before = await host(networkCommand);
  check("loopback network positive control", before.exitCode === 0 && before.text === "network-ok");
  const network = await run(networkCommand);
  check("named profile denies loopback with dedicated exit code", network.exitCode === 23);
  const after = await host(networkCommand);
  check("loopback remains reachable outside sandbox", after.exitCode === 0 && after.text === "network-ok");
  const env = await run(["/bin/sh", "-c", 'test -z "$CODEX_HOME" && test -z "$OPENAI_API_KEY" && test -n "$WREN_HOME"']);
  check("command environment omits login and ambient credentials", env.exitCode === 0);
  const pty = session.startCommand({ command: ["/bin/sh", "-c", 'printf "READY:"; /bin/stty size; while IFS= read -r line; do printf "ECHO:%s:" "$line"; /bin/stty size; done'], tty: true, size: { cols: 80, rows: 24 }, timeoutMs: 8_000 });
  // command/exec has no ready ack; retry is intentionally absent. Wait for
  // a command-owned readiness marker before follow-up controls.
  await waitFor(() => /READY:24 80/.test(output.get(pty.id) ?? ""));
  await pty.resize({ cols: 100, rows: 40 }); await pty.write(Buffer.from("pty-echo\n"));
  await waitFor(() => /ECHO:pty-echo:40 100/.test(output.get(pty.id) ?? ""));
  check("PTY stdin, output and actual resize", true);
  await pty.terminate();
  for (const mode of ["timeout", "disconnect"]) {
    const descendant = session.startCommand({ command: ["/bin/sh", "-c", '/bin/sleep 60 & child=$!; printf "PIDS:%s:%s\\n" "$$" "$child"; wait'], tty: true, timeoutMs: mode === "timeout" ? 750 : 15_000 });
    await waitFor(() => /PIDS:(\d+):(\d+)/.test(output.get(descendant.id) ?? ""));
    const pids = (output.get(descendant.id) ?? "").match(/PIDS:(\d+):(\d+)/).slice(1).map(Number);
    for (const pid of pids) { check(`${mode} descendant positive liveness control`, alive(pid)); childPids.add(pid); }
    if (mode === "disconnect") { const rejected = descendant.completed.catch(() => {}); await session.close(); await rejected; }
    else check("command timeout is not a successful exit", (await descendant.completed).exitCode !== 0);
    await waitFor(() => pids.every((pid) => !alive(pid)));
    check(`${mode} cleans up parent and descendant`, true);
    for (const pid of pids) childPids.delete(pid);
  }
  console.log(JSON.stringify({ ok: true, evidenceState: "tested_baseline", authenticated: false, checks }, null, 2));
} finally {
  try { await session?.close(); }
  finally {
    // These PIDs were obtained only from our nonce-scoped synthetic commands,
    // never a user/vendor-supplied production PID. Cleanup is not test success.
    for (const pid of childPids) { if (alive(pid)) process.kill(pid, "SIGKILL"); }
    await new Promise((resolve, reject) => server.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}
