# Troubleshooting

Recovery recipes for the common failure modes. Reach for `wren genbi status` and
`wren genbi logs` first — they are your external signal; don't guess.

## `wren genbi serve` exits with "app is out of sync with the MDL"
A `cube_panel` in `app.py` references a cube/measure/dimension the current MDL no
longer has. The message names what's missing. Either fix the `cube_panel` call to
use a valid name (`wren cube describe <cube>` to see them) or rebuild the MDL
(`wren context build`). Re-run `wren genbi check <name>` until clean.

## "app failed to start" (health never came up)
`serve` prints the tail of the log. Usually a Python error in `app.py`. Read more
with `wren genbi logs <name> -n 100`, fix the file, and `serve` again. Common
causes: a typo/ImportError, or calling `engine.query` with bad SQL (prefer
`cube_panel` / `raw_panel`).

## The page loads but a panel shows "Query failed: …"
The governed query errored at runtime (e.g. a filter value the source rejects).
The message is the DB/engine error. Adjust the filter/measure; the panel
hot-reloads on save.

## Port already in use / wrong URL
`serve` auto-picks a free port and is idempotent: serving an already-running app
re-prints its URL instead of starting a duplicate. If `list`/`status` shows
"stopped" but you expected running, the process died (or the machine rebooted) —
just `serve` again; it gets a fresh port.

## Edits don't show up
Saves hot-reload via `runOnSave`. If your editor writes via atomic replace and a
reload is missed, just save again, or `wren genbi stop <name>` then `serve`.
Never run `streamlit run` yourself — always go through `wren genbi`.

## Nothing is reachable at localhost
This feature requires the agent to run on the **user's own machine**. In a cloud
sandbox the user's browser can't reach `localhost`; there is no workaround here —
tell the user.

## Credentials / connection errors
The app uses the project's profile and `.env` (resolved because `serve` runs with
the project root as CWD). Don't put secrets in the app or
`.streamlit/secrets.toml`. Verify the connection with `wren profile debug`.

## After a reboot
Serving processes don't survive a reboot (by design — lifecycle isn't
supervised). `wren genbi list` shows your catalogued apps; `wren genbi serve
<name>` brings one back on a fresh port.
