import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PiPlanner, privateModel } from '../pi.mjs';
import { scriptedIntent, scriptedStream } from '../scripted.mjs';
import { piPlannerUnit } from '../eval.mjs';
import { scriptedBinding } from '../../eval/scripted.mjs';
import { cases } from '../../eval/scenarios.mjs';
import { createView } from '../tui.mjs';

test('pi uses the real OpenAI-compatible transport and exactly one bounded decision tool', async () => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const value = JSON.parse(body); requests.push(value);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta, finish_reason) => ({ id: 'test', object: 'chat.completion.chunk', created: 1,
      model: value.model, choices: [{ index: 0, delta, finish_reason }] });
    res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'decision', type: 'function',
      function: { name: 'resolve_intent', arguments: JSON.stringify(scriptedIntent(value.messages)) } }] }, null))}\n\n`);
    res.end(`data: ${JSON.stringify(chunk({}, 'tool_calls'))}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const model = new PiPlanner({ model: privateModel({ id: 'nvidia/nemotron-scripted', baseUrl: `http://127.0.0.1:${server.address().port}/v1` }), apiKey: 'synthetic' });
    const output = await model.decide({ conversation: [{ role: 'user', content: cases[0].question }], capabilities: [{ id: 'analytics' }], metadata: null });
    assert.equal(output.name, 'resolve_intent'); assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].tools.map(x => x.function.name), ['resolve_intent']); assert.equal(requests[0].temperature, 0);
    assert.equal(requests[0].max_tokens ?? requests[0].max_completion_tokens, 1536);
    assert.deepEqual(requests[0].chat_template_kwargs, { enable_thinking: false });
    assert.equal(requests[0].parallel_tool_calls, false);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('production pi executor remains independently evaluable through shared planner unit', async () => {
  const attempts = [];
  const unit = piPlannerUnit({ input: { conversation: [{ role: 'user', content: cases[3].question }], capabilities: [{ id: 'analytics' }],
    replies: [{ question_terms: ['指標', '期間'], answer: cases[3].human_answers[0] }] }, binding: scriptedBinding,
    signal: new AbortController().signal, observeAttempt: attempt => attempts.push(attempt) },
  { model: privateModel({ id: 'nvidia/nemotron-scripted', baseUrl: 'https://offline.invalid/v1' }), streamFn: scriptedStream() });
  const result = await unit.run(); assert.equal(result.final.name, 'plan_queries'); assert.equal(result.decisions.length, 2);
  assert.equal(attempts.length, 2); assert.equal(attempts[0].input_tokens, 20); assert.equal(attempts[0].cost_usd, null);
});
test('pi-tui adapter renders and receives input without owning task state', async () => {
  let input; const writes = [], submitted = [];
  const terminal = { columns: 100, rows: 30, start: onInput => { input = onInput; }, stop() {},
    write: value => writes.push(value), hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, moveBy() {},
    setTitle() {}, drainInput: async () => {} };
  const view = createView({ terminal, submit: value => submitted.push(value), quit() {} });
  try {
    view.start(); view.update('Private planner ready.');
    input('hello'); input('\r'); await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(submitted, ['hello']); assert.ok(writes.length > 0);
  } finally { view.stop(); }
});
