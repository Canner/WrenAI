# Application-owned Warble components

The current profile has three components:

- `resolve_intent`: extract user-supported analytical intent for host admission.
- `design_free_dashboard`: generate free HTML/CSS/JavaScript using the authorized
  aggregate and design brief.
- `repair_dashboard`: revise that frontend using bounded host diagnostics.

The host selects provider bindings and owns authorization, state, routing,
budgets and artifact admission. Components supply behavior, never authority.
Worker root/leaf behaviors live separately under `worker/profile/` and execute
inside Wren `serve agent`; metadata, SQL and database tools stay there.

## Compile and verify

From the example root, with the pinned Warble 0.21.1 compiler:

```sh
npm ci --prefix collaboration/runtime --no-audit --no-fund
WARBLE_BIN=./collaboration/runtime/node_modules/.bin/warble node behaviors/compile.mjs
WARBLE_BIN=./collaboration/runtime/node_modules/.bin/warble node behaviors/compile.mjs --check
node --test behaviors/test/*.test.mjs
```

`compiled/ir.json` and `compiled/manifest.json` are checked-in runtime inputs.
Source and IR hashes reject stale artifacts. Admission accepts only the supported
IR shape, tiers, one-shot calls and locked guardrails; unsupported execution
semantics fail rather than being silently flattened to prompt text.

Keep each unit's input/output contract, binding, cases and scorer fixed when
tuning it. Compile after a prompt change and run adjacent contract gates.
Release IDs include source paths and code hashes: moving modules creates a new
release even when prompts and contract versions remain unchanged. Preserve old
run manifests outside this package; do not relabel them with new release IDs.

See [independent evaluation](../eval/README.md) and the
[collaboration guide](../collaboration/README.md) for integration gates.
