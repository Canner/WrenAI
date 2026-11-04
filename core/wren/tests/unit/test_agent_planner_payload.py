"""Execute the example planner payload hook without a model or service connection."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")


def test_reasoning_override_only_applies_to_default_luna():
    client = (
        Path(__file__).resolve().parents[4]
        / "examples/serve-agent/planner-client/client.mjs"
    )
    harness = r"""
import {readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {SourceTextModule, SyntheticModule, createContext} from 'node:vm';
const code = await readFile(process.argv[1], 'utf8');
const seen = [];
for (const configured of [undefined, 'gpt-6-luna', 'another-model']) {
  const context = createContext({process: {argv: ['node','client','config','questions','output'],env: {}}});
  class Agent {
    constructor(options) { this.options=options; this.state={messages: []}; }
    async prompt() {
      this.options.streamFn(null, {}, {});
      this.state.messages.push({role:'assistant',stopReason:'stop',content:[]});
    }
  }
  class Client { async connect() {} async listTools() {return {tools:[]};} async close() {} }
  const exports = {
    'node:fs': {constants},
    'node:fs/promises': {readFile: async path => path==='config' ? JSON.stringify({model:configured,skill:'skill',serviceReplyTimeoutMs:200000}) : path==='questions' ? '["question"]' : '', open: async () => ({stat: async () => ({isFile: () => true}),chmod: async () => {},writeFile: async () => {},close: async () => {}})},
    '@earendil-works/pi-agent-core': {Agent},
    '@earendil-works/pi-ai/api/openai-completions': {streamSimple: (model,ctx,opts) => {const payload={reasoning_effort:'medium',marker:true};opts.onPayload(payload);seen.push(payload);}},
    '@modelcontextprotocol/sdk/client/index.js': {Client},
    '@modelcontextprotocol/sdk/client/stdio.js': {StdioClientTransport: class {}},
  };
  const module = new SourceTextModule(code, {context});
  await module.link(name => new SyntheticModule(Object.keys(exports[name]), function () {
    for (const [key,value] of Object.entries(exports[name])) this.setExport(key,value);
  }, {context}));
  await module.evaluate();
}
process.stdout.write(JSON.stringify(seen));
"""
    result = subprocess.run(
        [
            "node",
            "--experimental-vm-modules",
            "--input-type=module",
            "-e",
            harness,
            str(client),
        ],
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    )
    assert json.loads(result.stdout) == [
        {"reasoning_effort": "none", "marker": True},
        {"reasoning_effort": "none", "marker": True},
        {"reasoning_effort": "medium", "marker": True},
    ]
