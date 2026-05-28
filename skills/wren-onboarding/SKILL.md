---
name: wren-onboarding
description: "Onboard a user to Wren Engine end-to-end. Walks through environment checks, project scaffolding, connection configuration via .env, and first query. Use when: user wants to install Wren Engine, set up a new data source connection, or bootstrap a new project from scratch. Triggers: '/wren-onboarding', 'install wren', 'set up wren engine', 'wren onboarding', 'connect new database to wren'."
license: Apache-2.0
---

# wren-onboarding — moved into the `wren` CLI

This skill's content now lives inside the `wren` CLI itself, so it always
matches the installed wren-engine version. Fetch it with:

```bash
wren skills get onboarding
```

Add `--full` to include the reference docs, or `--script <name>` for any
bundled scripts. Run `wren skills list` to see everything available.
