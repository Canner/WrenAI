import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { connectWren } from '../wren-client.mjs';

const config = mode => ({ command: process.execPath,
  args: [fileURLToPath(new URL('./fixture-server.mjs', import.meta.url)), mode],
  credentialEnv: 'SCRIPTED_TEST_KEY' });
const connect = mode => connectWren(config(mode), { credential: 'synthetic-loopback-only' });

test('host client calls the stdio service and rejects tools outside the public worker boundary', async t => {
  const port = await connect('valid'); t.after(() => port.close());
  const request = { session_id: 'owned', expected_revision: 2, question: 'Revenue?' };
  assert.deepEqual(await port.call('ask_data', { request }, { timeoutMs: 1000 }),
    { method: 'ask_data', received: { request } });
  await assert.rejects(port.call('run_sql', { sql: 'SELECT 1' }, { timeoutMs: 1000 }), /invalid_contract/);
});

test('a service exposing raw SQL is refused during connection admission', async () => {
  await assert.rejects(connect('raw-sql'), /mcp_startup_failed/);
});

test('tool errors and ambiguous response envelopes cannot become worker results', async () => {
  for (const [mode, error] of [['tool-error', /mcp_tool_error/], ['ambiguous-text', /invalid_contract/]]) {
    const port = await connect(mode);
    try { await assert.rejects(port.call('ask_data', { request: {} }, { timeoutMs: 1000 }), error); }
    finally { await port.close(); }
  }
});
