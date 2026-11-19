import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PiPlanner, privateModel } from '../../host/pi.mjs';
import { decisionContract, admitDecision, admitWorker, registry, plannerContext } from '../contracts.mjs';
import { catalog, query, choose, plan } from './fixture.mjs';

test('planner and worker components independently execute via the real pi transport with scripted local model responses', async () => {
  const received = [], q = query(['channel']);
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text); received.push(body);
    const worker = body.tools[0].function.name === 'plan_semantic_query', proposed = worker ? plan(q) : choose(q, 'semantic_query');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta, finish_reason) => ({ id: 'test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] });
    res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'decision', type: 'function', function: { name: proposed.name, arguments: JSON.stringify(proposed.args) } }] }, null))}\n\n`);
    res.end(`data: ${JSON.stringify(chunk({}, 'tool_calls'))}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    for (const worker of [false, true]) {
      const model = new PiPlanner({ model: privateModel({ id: 'nvidia/nemotron-scripted', baseUrl: `http://127.0.0.1:${server.address().port}/v1` }), apiKey: 'synthetic', decisionContract: decisionContract(worker) });
      const r = registry(catalog());
      const output = await model.decide({ conversation: [{ role: 'user', content: 'Revenue by channel' }], capabilities: worker ? { request: q, sources: r.sources.filter(s => s.kind === 'semantic') } : plannerContext(r), metadata: worker ? { rule: 'PRIVATE_RULE' } : {} });
      const admitted = admitDecision(output, worker); assert.equal(admitted.status, 'ready');
      if (worker) assert.equal(admitWorker(admitted, q, r).kind, 'semantic');
      else assert.equal(admitted.route, 'semantic_query');
      assert.equal(model.calls.length, 1);
    }
    assert.equal(received.length, 2); assert(!JSON.stringify(received[0]).includes('PRIVATE_')); assert(JSON.stringify(received[1]).includes('PRIVATE_RULE'));
    assert.deepEqual(received.map(b => b.tools.length), [1, 1]);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
