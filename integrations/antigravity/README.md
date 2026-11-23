# OSS Wren plugin for Google Antigravity

Connects Antigravity to a local Wren project over MCP. The plugin starts the
open-source Wren engine on your machine (`wren serve mcp`, stdio, no network
listener), so queries go through your semantic layer and business rules.

For Wren AI Cloud or a self-hosted Wren AI install, use the Wren AI plugin in
the Antigravity Marketplace instead.

## Requirements

- Antigravity (app or `agy` CLI)
- [`uv`](https://docs.astral.sh/uv/) on `PATH`; the plugin runs `wrenai` with `uvx`
- A Wren project with a built `target/mdl.json` (`wren context build`) and a
  Wren home folder holding a profile for its data source

## Install

```bash
git clone https://github.com/Canner/WrenAI
agy plugin install WrenAI/integrations/antigravity
```

Then open Customizations > Plugins > OSS Wren in Antigravity, fill in the two
settings and enable the plugin:

| Setting | Value |
|---|---|
| `WREN_PROJECT_DIR` | Absolute path to the folder with `wren_project.yml` |
| `WREN_HOME_DIR` | Absolute path to the folder holding `profiles.yml` (usually `~/.wren`) |

The plugin installs `wrenai[mcp]` only. If your data source needs an extra
(for example `postgres`), edit `mcp_config.json` to `wrenai[mcp,postgres]`.

## Layout

| Path | What |
|---|---|
| `.antigravity-plugin/plugin.json` | Plugin manifest |
| `mcp_config.json` | Starts `wren serve mcp` and declares the two settings |
| `skills/wren-semantic-analytics/` | Agent skill: how to use the Wren tools |
