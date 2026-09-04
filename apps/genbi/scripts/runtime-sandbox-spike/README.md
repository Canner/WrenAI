# Vendor runtime sandbox Phase 0 probes

These scripts validate vendor-owned isolation primitives without connecting them to GenBI production routes or changing
the default runtime backend. The deterministic probes do not run an authenticated model turn.

Run from `apps/genbi`:

```bash
node scripts/runtime-sandbox-spike/codex-app-server-probe.mjs
node scripts/runtime-sandbox-spike/codex-connection-cleanup-probe.mjs
node scripts/runtime-sandbox-spike/codex-schema-contract-probe.mjs
node scripts/runtime-sandbox-spike/rpc-client-probe.mjs
node scripts/runtime-sandbox-spike/sandbox-runtime-probe.mjs
```

The authenticated Codex gate is intentionally separate and refuses to run without an explicit environment switch:

```bash
GENBI_RUN_CODEX_AUTHENTICATED=1 node scripts/runtime-sandbox-spike/codex-authenticated-turn-probe.mjs
```

It attempts one Codex turn through the caller's existing ChatGPT authentication. It runs `codex exec` inside an
app-server `command/exec` sandbox, ignores user configuration and project rules, permits one mock MCP tool, requests one
harmless command, and rejects missing tool evidence or unexpected file/web items. It never reads or copies `auth.json`;
the path is used only as an existence/readiness signal and remains caller-owned. On Codex 0.146.0 the strict read-only
boundary fails closed before provider/model execution because nested `codex exec` needs to initialize runtime state in
that same home; see the report and ADR.

The direct app-server replacement requires a non-default, externally authenticated, writable runtime home. Authenticate
that home outside the agent sandbox, then explicitly pass its path to the probe:

```bash
CODEX_HOME=/path/to/isolated-codex-home codex login --device-auth
GENBI_RUN_CODEX_AUTHENTICATED=1 \
  GENBI_PHASE0_CODEX_HOME=/path/to/isolated-codex-home \
  node scripts/runtime-sandbox-spike/codex-direct-authenticated-turn-probe.mjs
```

The app-server control plane may write its own runtime state there, while the model turn receives a separate read-only
filesystem policy with command-network access denied. The probe configures only the public mock MCP fixture, removes
ambient API-key and Wren project redirects, rejects the default Codex home, and verifies command, MCP, final-message, and
forbidden-item evidence from app-server events.

The macOS Phase 0 scope requires a `codex` executable with app-server `command/exec` support. The Codex probes use an
isolated temporary `CODEX_HOME`, send the documented initialization handshake, and validate buffered execution,
filesystem and network denials, environment removal, command timeout with descendant cleanup, PTY
streaming/input/resize, explicit termination, connection-loss cleanup, and safe malformed-protocol rejection. Read and
network denial checks first run the same command successfully outside the sandbox and then require the sandboxed command
to fail with its dedicated denial evidence. The deterministic probes never call `turn/start`, because
that would begin a model-backed turn; the generated app-server protocol schema is the deterministic source for checking
the `turn/start.sandboxPolicy` contract.

The sandbox-runtime probe downloads the pinned `@anthropic-ai/sandbox-runtime@0.0.75` package through `npm exec` when
`SRT_BIN` is not set. It validates filesystem, network, descendant-process, and missing-runtime behavior, then starts
`claude --version` inside the whole-process sandbox when Claude is installed. The read and network commands must first
succeed outside SRT; their sandboxed forms must then produce explicit denial evidence. Descendant containment passes
only when the child process starts and its protected read is specifically denied. Exercising actual Claude file tools,
hooks, and MCP servers requires an authenticated model turn and remains a separate explicit gate.

The authenticated Claude gate also requires a non-default runtime home authenticated outside the sandbox. It refuses to
run without both explicit environment switches:

```bash
CLAUDE_CONFIG_DIR=/path/to/isolated-claude-home claude auth login --claudeai
GENBI_RUN_CLAUDE_AUTHENTICATED=1 \
  GENBI_PHASE0_CLAUDE_HOME=/path/to/isolated-claude-home \
  node scripts/runtime-sandbox-spike/claude-authenticated-turn-probe.mjs
```

The probe wraps the complete Claude process tree in one authoritative sandbox-runtime boundary, loads only a scoped
mock MCP server, and runs one model turn. It explicitly sets `sandbox.enabled=false` so Claude does not start a nested
Bash sandbox: nested macOS Seatbelt fails
closed inside the outer SRT boundary, while enabling weaker nested isolation would reduce the intended protection. The
launcher has no path that runs Claude without outer SRT, so this is not an unsandboxed fallback. Workspace file access
must succeed, while an external canary remains protected. The probe does not use Claude's `--restricted` mode because
its permission path rejects the generated Bash child before launch. Tool exposure remains limited by `--tools`; only the
pinned Node executable prefix is pre-approved for Bash inside the authoritative outer SRT boundary. Write/web tools are
denied, and `dontAsk` fails closed for anything not pre-approved. The probe still requires exactly one Bash invocation
and the nonce-bound child attestation. The external canary read must fail through the file tool, hook process, Bash child,
and MCP child. Provider access is limited to the Anthropic provider and authentication endpoints; all other network
destinations remain denied. On macOS, the
external launcher reads the fresh OAuth access token from Keychain without printing or persisting another copy, then
uses sandbox-runtime credential masking so sandboxed processes see only a sentinel and the proxy injects the real token
only for `api.anthropic.com`. Loopback provider overrides are removed because SRT correctly refuses to inject credentials
into loopback destinations.

Claude and its launch helpers receive a unique short-lived temp directory through `CLAUDE_CODE_TMPDIR`, `CLAUDE_TMPDIR`,
`BUN_TMPDIR`, `TMPDIR`, `TMP`, and `TEMP`. Only that directory is writable, and it is deleted with the rest of the probe
state. The Claude-specific variables are required because the Bash runner creates its cwd helper below its own temp root
rather than relying only on standard `TMPDIR`. The short path is also required because SRT creates Unix sockets below
`TMPDIR` on macOS and fails closed when a deeply nested worktree path exceeds the platform socket-path limit.
The separately approved authenticated replay with all six variables bound to that directory passed every assertion,
including inherited outside-read denial and OAuth masking in the actual Bash command child.

The executable probes create unique probe paths and remove them on exit. A failed denial or cleanup assertion exits non-zero.

The maintained deterministic contract entry point is `pnpm run check:vendor-contract`. In CI it installs the exact macOS
tested-baseline vendor components in a job-local directory, checks those exact identities, and then runs the RPC, Codex
lifecycle/schema/cleanup, and sandbox-runtime probes. It intentionally does not run either authenticated probe or any
model-backed turn. A passing tested baseline is evidence only, not a certified production compatibility row.

Linux, WSL2, and native Windows validation are outside this macOS-only Phase 0 scope.

See `PHASE-0-REPORT.md` for the current evidence and scope matrix, and `ADR-codex-native-terminal.md` for the
conditional Codex terminal transport decision.
