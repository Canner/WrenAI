# Noninteractive native producer

`harness/native-producer` is the deterministic replacement seam for supported
headless consumers. It is not an interactive terminal API: terminal bytes,
prompts, dispatcher protocol records, credentials, capability credentials,
session identifiers, and arbitrary tool inputs or outputs never cross its
versioned host contract.

The host validates a one-way binding digest and an explicit contract version, emits only
the synthetic lifecycle `accepted → running → completed|failed`, returns a
bounded sanitized final result, and admits artifact references only when their
ID, digest, and idempotency tuple matches the server's live host fence. Errors are stable categories rather
than raw subprocess diagnostics. A cassette records this already-sanitized
contract, so replay never depends on a vendor's opaque stream format.

The current adapter uses the existing subscription route after its Claude or
Codex dispatcher mapper has validated the vendor stream. It does not change
the dispatcher protocol and does not fall back between vendors.

## Caller migration matrix

| Current caller / asset | Current owner | Migration state | Compatibility rule |
| --- | --- | --- | --- |
| `server/turn.ts` and `/api/sessions/*` | Structured Ask | Not migrated | Retain all routes, stored rows, SSE replay, clarify, and artifact mutations. |
| `harness/route/dispatched.ts`, `harness/route/codex-ask.ts`, and `server/turn.ts` | Structured Ask runtime | Adapter available; not switched | Keep existing Claude/Codex dispatch and mapper contracts; a caller must opt into the producer. |
| `test/bff-resume.test.ts`, `test/bff-artifact-publish.test.ts`, and `test/bff-store.test.ts` | Structured Ask replay consumers | Not migrated | Preserve their stored-turn and artifact replay coverage. |
| `test/codex-ask.test.ts`, `test/chat-event-mapper.test.ts`, `test/dispatched.test.ts`, and `test/run-agent.test.ts` | Offline dispatcher consumers | Not migrated | Preserve process seams and vendor-specific mapper coverage. |
| `harness/replay/*`, `test/cassette-*.test.ts`, and `test/fixtures/cassettes/*` | Cassette/replay consumers | Not migrated | Preserve raw-dispatcher capture/replay and sanitizer behavior. |
| `src/eval/*` fixtures | Eval-style frontend consumers | Not migrated | Keep current fixtures until a named consumer adopts the producer contract. |
| `core/wren` packaged Ask templates | Core CLI | Not a GenBI BFF caller | No migration implied. |

No compatibility entry, fixture, route, or Ask runtime is removed by this
change. Moving any row requires an explicit caller change plus a separately
approved compatibility-window decision.
