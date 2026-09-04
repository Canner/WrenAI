# Vendor runtime sandbox Phase 0 report

Date: 2026-09-04

## Outcome

**Go for a direct Codex app-server adapter** and **no-go for a nested authenticated Codex CLI TUI with a read-only
caller-owned `CODEX_HOME`**. The local macOS evidence supports direct app-server `turn/start`, app-server
`command/exec`, and Anthropic sandbox-runtime as isolation primitives. The authenticated Claude file-tool, hook, and MCP
checks and its actual Bash-child process boundary pass in one all-green replay. The macOS-only Phase 0 validation is
complete; production wiring remains a separate phase.

No production route, database schema, or default backend was changed. Authenticated Codex calls were made only after
explicit approval: the nested-TUI attempt failed before provider/model execution, and its direct app-server replacement
completed one model turn.

## Tested versions

- Codex CLI/app-server: 0.146.0
- Claude Code: 2.1.259
- `@anthropic-ai/sandbox-runtime`: 0.0.75, beta research preview
- Host probe: macOS arm64

## Deterministic results

### Codex app-server

Passed:

- generated-schema contract for `turn/start.sandboxPolicy` and `command/exec.sandboxPolicy`;
- buffered `command/exec`;
- workspace write allowed;
- workspace-external write denied;
- workspace-external read positive control succeeded, then the named permission profile produced the dedicated denial exit code;
- loopback network positive control succeeded, then the sandboxed command produced the dedicated network-denial exit code;
- poisoned `WREN_PROJECT_HOME` explicitly removed from command environment;
- timeout terminates the command and its descendant process;
- PTY streaming, stdin, resize, clean exit, and explicit terminate;
- connection close terminates the command and its descendant process;
- Codex TUI startup inside a `command/exec` PTY without starting a model turn;
- schema guard that `thread/shellCommand` and `process/spawn` are not valid sandbox primitives;
- malformed app-server JSON rejects pending RPCs without throwing from the readline callback or retaining raw protocol content.

Fine-grained read denial currently depends on the beta permission-profile API. The adapter therefore needs a pinned
minimum Codex version, capability negotiation, and fail-closed behavior when the profile is missing or rejected.

An earlier outside-read assertion used the Homebrew Node executable and accepted any non-zero exit. A discriminating
positive control exposed that the named profile blocked Node's external `libuv` before the command could read the canary.
The final probe instead runs the same system `/bin/cat` command successfully on the host, then requires the sandboxed
command to fail with an explicit permission-denied diagnostic. The network probe similarly proves the same command can
reach a temporary loopback server on the host before requiring its sandboxed form to return the dedicated denial code.

### Anthropic sandbox runtime

Passed:

- workspace write allowed;
- workspace-external read positive control succeeded, then SRT produced an explicit permission-denied diagnostic;
- workspace-external write denied and the canary remained unchanged;
- loopback network positive control succeeded, then SRT returned the dedicated network-denial exit code;
- a descendant process started and inherited the explicit permission denial for the protected read;
- a missing sandbox-runtime executable fails at launch rather than running the target directly;
- installed Claude Code binary starts inside the whole-process sandbox with `--version`, without a model turn.

Earlier SRT read, network, and descendant checks accepted generic non-zero child results. The final forms require the
same read and network commands to succeed outside SRT first, then distinguish the expected denial from unrelated launch,
runtime-library, connectivity, and child-spawn failures. This mirrors the discriminating controls used by the Codex
probe and is the evidence behind the whole-process containment conclusion.

This proves the runtime process-tree boundary, not actual Claude file-tool, hook, and MCP behavior. Those features are
activated by a Claude turn and were exercised by the separately approved smoke below.

## Authenticated Claude result

The approved macOS smoke used a non-default writable `CLAUDE_CONFIG_DIR` authenticated outside sandbox-runtime. Native
Claude OAuth is stored in macOS Keychain, which is intentionally inaccessible inside the whole-process Seatbelt
boundary. The probe therefore reads the fresh access token in the external launcher and delegates protection to
sandbox-runtime 0.0.75 credential masking: Claude, hooks, commands, and MCP children see only a sentinel, while the SRT
proxy injects the real token solely for `api.anthropic.com`. SRT rejects credential injection into the configured
loopback proxy, so this probe removes that ambient override and directly allows only the Anthropic provider and auth
hosts. It does not enable Apple Events, weaker nested isolation, weaker network isolation, or unsandboxed fallback.

One real Claude turn completed with the exact requested tool sequence: workspace `Read`, denied external `Read`, `Bash`,
and the single scoped mock MCP `query`. The captured evidence passed for workspace read, external file-tool denial, hook
process denial, MCP-child denial, token masking, unchanged canary, exact final response, and absence of unrequested tools.

The probe process nevertheless reported one failed assertion because its original Bash-event selector incorrectly
searched the command text for a nonce that exists only in the command child's output. A first corrected replay completed
the Claude turn and again passed every other assertion, but its combined command diagnostic could not distinguish the
selector from the attestation. The next separately approved hardened replay observed exactly one Bash tool and a missing
child attestation; all other assertions passed again. This proves the remaining issue is not merely the selector, and the
actual Bash child boundary is not yet established by an authenticated turn.

A no-model command-child preflight after each replay passed outside-read denial, OAuth sentinel masking, successful
attestation write, and unchanged canary under the same outer SRT policy. That proves the outer policy remains functional,
but not that Claude's nested Bash execution completed. The harness now records safe booleans and categories for whether
the Bash command referenced the child and whether its tool result was missing, successful, denied, not found, timed out,
or otherwise failed. It does not emit command text, paths, or tool-result content. Diagnosing this gap and producing a
single-run all-green artifact requires another separately approved authenticated replay.

That diagnostic replay observed one Bash tool whose command referenced the generated child, a permission-or-sandbox
tool error, and no child attestation. The command was therefore selected correctly but was rejected or terminated before
the child could record execution. This does not yet distinguish an unavailable nested sandbox from a pre-launch
permission denial. The next harness revision writes a nonce-bound token-masking start attestation before attempting the
forbidden read. It accepts either a denial caught by the child or a Bash tool denial that references the unique canary,
while still requiring the canary to remain unchanged. Its no-model outer-SRT preflight passes; validating the Claude Bash
path remains a separately approved model-backed gate.

The separately approved pre-attestation replay produced the same pre-launch permission-or-sandbox error: the Bash command
referenced the generated child, but there was no start attestation and the tool error did not reference the denied canary.
A subsequent no-model outer-SRT-to-inner-`sandbox-exec` probe reproduced that shape with exit code 71 and no child start.
This establishes that nested macOS Seatbelt cannot initialize inside the authoritative outer SRT boundary. The candidate
probe therefore removes Claude's second Bash sandbox while retaining the outer SRT around Claude and its entire process
tree. It does not enable weaker nesting or add a direct/unsandboxed launcher; missing outer SRT still fails closed. One
separately approved outer-only authenticated replay is required before accepting this candidate.

The approved authoritative-outer-SRT replay still failed before child start with the same permission-or-sandbox tool
error, despite the nested Claude sandbox being absent. This rules out nested Seatbelt as the immediate cause of that Bash
denial and leaves Claude's tool permission rule as the remaining launch gate. The next candidate replaces the broad bare
`Bash` permission with one exact, generated command rule and passes that rule as its own CLI argument; it does not bypass
Claude permissions. This permission candidate requires a separately approved authenticated replay.

The exact-command-permission replay was rejected at the same point. A no-model shell-command preflight then ran the same
shell and generated child successfully under the same outer SRT policy, including the start/token-mask attestation,
outside-read denial, and unchanged canary. This rules out shell startup and the outer filesystem boundary and left
Claude's `--restricted` permission path as the next candidate. That candidate removes `--restricted` while retaining the
explicit `--tools` set, exact Bash allow rule, deny rules, `dontAsk`, and authoritative outer SRT. It does not use bypass mode or an
unsandboxed launcher and requires a separately approved authenticated replay.

The non-restricted exact-permission replay was still rejected before child start. Removing `--restricted` therefore did
not resolve the denial. The remaining candidate is command normalization: the tool input referenced the child but may not
have matched the generated exact rule byte-for-byte, causing `permission-prompts none` to deny it locally. The next probe
uses Claude's documented bare `Bash` auto-allow in non-restricted mode, while `--tools` limits exposure, the harness
requires exactly one Bash invocation and nonce-bound child evidence, and authoritative outer SRT remains the security
boundary. This is not permission bypass and requires a separately approved authenticated replay.

The non-restricted bare-Bash replay still failed before child start even though the observed tool command exactly matched
the requested command. Claude 2.1.259 contains policy paths that may strip broad Bash rules or ignore CLI allow rules under
a managed-only policy; no local managed-settings file was present, but runtime policy may still apply. The next candidate
uses a narrow `Bash(<pinned-node> *)` prefix rule instead of either a quoted exact rule or bare Bash. It also captures a
temporary Claude debug log inside the probe workspace and emits only booleans for ignored rules, managed-only policy,
broad-rule stripping, local prompt denial, or sandbox unavailability before deleting the log. Raw debug content is never
reported or retained. This candidate requires a separately approved authenticated replay.

The Node-prefix-permission replay was still denied before child start. Its safe debug classifications found no ignored
allow rule, managed-only override, broad-rule stripping, local prompt denial, or sandbox-unavailable marker. Since the
same shell command succeeds in the no-model outer-SRT preflight, the next candidate supplies Claude's Bash launcher with
a unique writable temp directory and scrubs shell-startup environment variables. The first temp preflight used a deeply
nested worktree path and SRT failed closed because its Unix socket path exceeded the macOS limit; switching to a unique
short system-temp directory fixed that infrastructure issue, and the temp-write preflight passed. The directory is an
explicit narrow SRT allow and is deleted after each run. This candidate requires separate authenticated approval.

The scoped-temp Node-prefix replay still failed before child start. The Bash error referenced the system-temp namespace
but not the workspace or runtime home; because the scoped directory itself is below system temp, that classification did
not distinguish the approved directory from a different temp sandbox/socket path. The next candidate explicitly sets
Claude `sandbox.enabled=false` rather than relying on an absent setting, adds a dedicated runtime-temp match, and includes
a bounded error tail with credentials, nonces, and local paths redacted. The authoritative outer SRT policy is unchanged.
This candidate requires separate authenticated approval.

The explicit-inner-sandbox-off replay returned `EPERM` while creating a system-temp directory outside the scoped runtime
temp. Claude's embedded runner code creates a `claude-<id>-cwd` helper and recognizes `CLAUDE_CODE_TMPDIR` and
`CLAUDE_TMPDIR`; standard `TMPDIR` alone did not redirect that path. The next candidate binds those variables plus
`BUN_TMPDIR`, `TMPDIR`, `TMP`, and `TEMP` to the unique allowed temp directory. The no-model temp preflight verifies that
all six variables resolve to one writable directory. No system-temp glob is allowed. This candidate requires separate
authenticated approval.

The separately approved Claude-specific-scoped-temp replay completed as one all-green authenticated turn. The workspace
file read succeeded; the workspace-external file read failed; the hook, Bash command child, and scoped MCP child all
inherited outside-read denial and saw only the masked OAuth credential; the outside canary remained unchanged; the final
response carried the nonce-bound attestation; and no unrequested tool was used. This closes the remaining authenticated
macOS Bash-child evidence gap without allowing a system-temp glob, unsandboxed fallback, or production route.

## Authenticated Codex result

The approved nested Codex smoke did not reach a provider/model turn. The outer read-only `command/exec` sandbox could
verify the caller-owned ChatGPT login, but nested `codex exec` then attempted to initialize its state database under the
same `CODEX_HOME`. That write was denied and startup failed closed before either the harmless command or scoped mock MCP
tool ran.

The probe did not copy credentials, grant write access to the caller's authentication home, or fall back to host
execution. Making that home writable would expose authentication/configuration state to the nested agent process and is
not an acceptable implicit workaround. The native Codex terminal prototype must therefore switch to an app-server
event UI unless a vendor-supported split between read-only credentials and an isolated writable runtime home is proven.

The replacement direct app-server smoke used a non-default runtime home that was created writable and authenticated
outside the agent sandbox. The app-server control plane could write its own state there, while `turn/start` applied a
separate read-only filesystem policy with command-network access denied. The single turn passed all checks:

- a harmless `/bin/echo` command completed inside the turn sandbox;
- exactly one allowlisted mock MCP `query` call completed;
- the final `agentMessage` contained the nonce-bound attestation;
- the turn emitted no file-change or web-search item; and
- `turn/completed` matched the started turn.

This establishes the required credential/runtime-state ownership split without giving the model command write access to
the runtime home. Standard `readOnly` does not establish outside-read denial; production must select the named
permission-profile path already covered by the deterministic probe. The turn also validates app-server events as the
native Codex UI transport.

## Platform matrix

| Platform | Codex | Claude whole-process runtime | Phase 0 evidence |
| --- | --- | --- | --- |
| macOS arm64 | Supported | Supported through Seatbelt | Deterministic and separately approved authenticated probes passed |

Linux, WSL2, and native Windows validation are explicitly outside this macOS-only Phase 0 scope. They may be evaluated
in a later cross-platform rollout ticket and do not gate this macOS-only Phase 0 decision.

## Remaining gates

None within the macOS-only Phase 0 scope.

## Recommendation

- The direct Codex `RuntimeHost`/event-UI design may proceed for the validated macOS runtime scope.
- Use a named permission profile for production outside-read denial; standard `readOnly` is not sufficient for protecting
  readable credential state from an adversarial command.
- Treat Claude file tools, hooks, Bash children, and MCP children as supported on the validated macOS runtime scope.
- Keep local `node-pty` as development-only and never select it automatically after a vendor backend failure.
- Pin vendor versions and rerun these probes on every supported-version update.
