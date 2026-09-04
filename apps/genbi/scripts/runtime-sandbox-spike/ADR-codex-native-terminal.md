# ADR: Codex native terminal transport

## Status

Accepted Phase 0 decision: use an app-server event UI for authenticated native Codex sessions.

## Decision

Do not ship the authenticated native Codex experience as a nested Codex CLI TUI launched in an app-server
`command/exec` PTY. Use a direct app-server thread/turn integration and render its events in a terminal-like GenBI UI.
GenBI must give every turn a server-owned sandbox policy or permission profile.

Keep `command/exec` for explicitly scoped standalone command execution where its streaming or PTY lifecycle is needed.
Do not use `thread/shellCommand` or `process/spawn`, and do not fall back to a BFF-local unsandboxed PTY.

Structured Codex Ask/Setup remains a direct app-server thread/turn integration; it does not launch a nested TUI.

## Evidence

On Codex CLI 0.146.0 for macOS arm64, the Phase 0 probe established without starting a model turn that:

- `command/exec` runs buffered commands with filesystem and network sandbox enforcement;
- `command/exec` timeout terminates both the command and its descendant process;
- PTY output, stdin, resize, normal exit, and explicit terminate work;
- a Codex CLI TUI reaches its interactive startup screen inside that PTY and is terminable through app-server;
- closing or terminating the command is controlled by the connection-scoped process id;
- fine-grained outside-read denial works through a named permission profile, which currently requires the
  `experimentalApi` capability.

The generated 0.146.0 protocol schema independently states that `turn/start` and `command/exec` accept sandbox policy,
while `thread/shellCommand` is unsandboxed with full access and `process/spawn` runs without a Codex sandbox.

The explicitly approved authenticated smoke then established a blocking incompatibility before any provider/model call:
the outer read-only sandbox could verify the caller-owned ChatGPT login, but nested `codex exec` needed to initialize a
state database under that same `CODEX_HOME`. The write was denied and startup failed closed. The probe did not make the
authentication home writable, copy credentials, or fall back to host execution.

## Authenticated validation

The direct app-server replacement was then authenticated through a non-default isolated writable runtime home created
and logged in outside the agent sandbox. One `thread/start` plus `turn/start` flow completed with a server-owned
read-only sandbox policy and command-network denial. App-server events proved that the harmless command completed,
exactly one scoped mock MCP tool ran, the nonce-bound final message arrived, no file or web item completed, and the
completion event matched the started turn.

## Consequences

The PTY mechanics remain useful for standalone sandboxed commands, but they no longer justify nesting the authenticated
Codex CLI. Native Codex sessions should render direct app-server item and turn events. The app-server runtime home is
control-plane state: it must be isolated per GenBI runtime identity, externally authenticated, writable by app-server,
and never mounted as a model-command writable root. Production turns must use the validated named permission-profile
path to deny outside reads; standard `readOnly` only proves write and network denial. A vendor-supported credential and
runtime-state split may justify revisiting the nested-TUI option; granting the nested agent write access to a caller's
default authentication home does not.
