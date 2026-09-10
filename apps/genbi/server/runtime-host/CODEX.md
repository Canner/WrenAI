# Codex backend contracts

The server-side backend, RPC and process contracts are implemented independently of
production backend activation. The packaged certification registry deliberately
contains no execution grants. The application still uses its existing backend
composition.

## RPC and cleanup

`CodexRpcClient` consumes newline-delimited JSON, registers pending requests
before writing, and correlates replies by connection-local numeric IDs.
Malformed frames, unsolicited server requests, duplicate/unknown response IDs,
transport loss, cancellation, and timeouts invalidate the whole connection.
Pending requests reject with fixed errors; remote error messages and stderr are
never retained in diagnostics. Incoming and outgoing frames are bounded to
1 MiB, and at most 128 requests can be outstanding.

The consuming adapter must validate notification methods and payloads in its
callback; throwing rejects the connection. Known notifications still require
operation-specific handling. In particular, an isolated Codex baseline process
emits `remoteControl/status/changed` during startup, even without a thread.

Every owner must await `close()`, including after failed requests, to distinguish
an operation failure from incomplete process cleanup. The stdio transport owns a
POSIX process group. It closes stdin, sends TERM, then escalates to KILL with
bounded liveness checks. EPERM means exit is unproven; only ESRCH establishes that
the group is gone. Cleanup failures are reported, never silently accepted.
Process groups cover inherited descendants, not processes that independently
create another session; vendor sandbox/connection cleanup evidence is still
required before certification.

## Certification

`evaluateCodexIdentity` compares the exact baseline version, executable digest,
source, protocol digest, required contracts, and evidence records. The optional
row argument is a pure release-validation/test seam. A successful fixture
comparison cannot mutate the empty packaged registry or activate a backend.
The backend hashes the selected native executable before running its bounded
version query. The reviewed row binds that executable to its generated schema
and behavior evidence. npm shell/Node wrappers are not executable identities:
composition must resolve the package's native platform binary and capture its
source identity. No ambient PATH discovery happens at session launch.

Initialization validates platform, home and version-bearing user agent, checks
the effective configuration with `config/read`, and requires the selected
`permissionProfile/list` entry to be allowed. Null optional configuration fields
mean absence; additional non-null filesystem, network or environment grants are
rejected. An initialize acknowledgement alone is never certification.

## Server-owned permission mapping

The generated Codex 0.146.0 schema documents mutually exclusive forms:

| Operation | Inline policy | Named permission profile |
| --- | --- | --- |
| `thread/start` | `sandbox` | `permissions` |
| `turn/start` | `sandboxPolicy` | `permissions` |
| `command/exec` | `sandboxPolicy` | `permissionProfile` |

The backend always uses the right-hand column. Inline SandboxPolicy has no
protected-read rules and cannot be combined with a named profile. Each launch
builds its sole `genbi-scoped` profile from the host-owned `NativeRuntimeSpec`:

- Workspace write, managed generation/tool directories/project/data roots read.
- Selected session Wren home read-only; original project `.env` and vendor login
  home denied. Selected database-secret material remains owned by the existing
  Wren-home materializer, not copied by this adapter.
- Command network disabled, shell environment inherited from nothing, and only
  explicitly selected variables set. `CODEX_HOME` belongs only to app-server;
  it is unset for commands. No provider key is inherited from the BFF.
- Unscoped MCP, hooks, plugins, browser/computer tools, apps, multi-agent and
  dependency-installation features are disabled. Their future scoped support is
  not implied by command sandbox evidence.

The externally authenticated Codex home must be private and separate from the
workspace, tools and default user home. This adapter does not copy/login/logout
credentials. Custom configuration, user skills and project `.codex` directories
in workspace ancestry fail closed; only the vendor-seeded `.system` skill
namespace is admitted. No arbitrary caller config/env/policy/cwd override exists
on the command interface. Symlinks, glob-bearing policy paths and credential-root
read grants are rejected. The vendor, not GenBI, enforces the sandbox.

## Launch and generation ownership

Phase 5 composition must call `prepareLaunch()` **before** writing durable session
rows or materializing a workspace. It resolves the approved managed runtime and
certified vendor identity without fetching, installing or creating directories.
The opaque, single-use permit pins that exact managed record. Call
`permit.assertActive()` immediately before each materialization or persistence
step, so a delayed permit cannot authorize a changed generation. Call `release()` if
materialization is abandoned; never accept a serialized permit from a client.

`open(permit, { spec, wrenHome, assertScopeActive, onEvent })` revalidates the
managed closure, vendor identity, active binding/generation guard, Wren-home
identity and derived policy before spawning. Subsequent operations repeat those
checks; they cannot switch generations. `retainedManifestDigests()` is the retain
set the cleanup owner must union with current/rollback generations. Cleanup
failures retain the lease; do not garbage-collect it on a failed close.

`probe()` can supply RuntimeHost's Codex-only vendor probe seam; it never changes
the other backends' results. No existing API, Ask/Setup/native Sessions routing,
or default backend selection is changed by these modules. Scoped MCP/broker
integration and browser event UI remain later composition work.

## Direct events versus command/PTY

`startThread()` creates one ephemeral thread. `runTurn(text, { timeoutMs, signal })`
resolves on `turn/completed`, **not** the start acknowledgement. Turn statuses are
`completed`, `interrupted`, or `failed`; raw vendor error details are omitted.
Start/completion and item events that arrive before the start reply are buffered
within 128 events / 1 MiB, then correlated by thread/turn/item identity.

`onEvent` receives the explicit typed projection in `codex-events.ts`, not an
opaque notification. Unknown methods, unsupported tool/item types, wrong IDs,
duplicate completions, malformed payloads or callback failure close the entire
connection. Valid disabled remote-control status is consumed without exposing
its host identity. Event content is user-facing transcript data, not diagnostics;
the UI must render it as untrusted content. Replay/storage belongs to Phase 5.

`startCommand({ command, tty?, size?, timeoutMs? }, signal?)` returns an owned
handle with `completed`, `write`, `resize` and `terminate`. Output is streamed as
base64 bytes; final command results contain an exit code, with no duplicated
buffered output. Limits: 16 commands, 256 KiB per output stream, 64 KiB per stdin
write, 500x500 terminal size, and five minutes per command/turn. Resize requires
a PTY; writes after stdin close or completion are rejected. There is no command
ready acknowledgement: consumers that need readiness must use command-owned
output; control request errors are terminal, never retried on the host.

`interruptTurn()` sends the scoped interrupt and still waits for completion under
a two-second watchdog. Abort, timeout, malformed protocol, disconnect and shutdown
invalidate the connection and settle outstanding work. `terminate()` awaits both
the command control acknowledgement and the final command result. Always await
`session.close()`; `backend.shutdown()` also owns connections still initializing.
The transport gives EOF cleanup a short grace period, then TERM/KILL escalation;
process cleanup is bounded to approximately 2.7 seconds. A cleanup error is not a
successful cancellation.

Backend launch failures use `CodexBackendError.code` and fixed browser-safe
messages. Low-level `CodexRpcError.reason` values are fixed tokens (`protocol`,
`permission`, `remote`, `transport`, `closed`, `cancelled`, `timeout`, `cleanup`).
Consumers must distinguish cleanup failure from operation failure, never forward
arbitrary exceptions, and never fall back to local execution.
Initialization/shutdown cleanup failure uses `codex_app_server_cleanup_failed`
and explicitly retains the affected generation.

## Verification and remaining activation gates

Deterministic tests cover RPC, negotiation/config mismatch, permits/generation,
scope/environment, direct events, command/PTTY controls and cleanup failures.
`scripts/codex-backend-probe.mjs` exercises the compiled driver on the exact macOS
baseline with synthetic login/Wren fixtures, positive file/network/liveness
controls, PTY resize, timeout and disconnect descendant cleanup. It never starts
a thread/model turn. It runs beside the existing exact vendor probes in macOS CI.
Packed-install acceptance loads these modules through `npx` with checkout access
blocked and proves that fixture protocol success cannot make production ready.

The certified registry remains empty; the managed manifest remains staged with
licence approval pending. Real approved-runtime and authenticated named-profile
turn acceptance are not claimed. Release approval, exact certification evidence
and later application wiring must all precede activation.

Protocol reference: [Codex App Server](https://developers.openai.com/codex/app-server).
The installed baseline's generated schema remains the version-specific reference.
