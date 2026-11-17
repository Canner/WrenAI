import test from 'node:test';
import assert from 'node:assert/strict';
import { NemotronPlanner, PlannerTimeout } from '../model.mjs';
import { plannerContract } from '../intent.mjs';
import { intentResponse } from '../../eval/scripted.mjs';

const caps = [{ id: 'analytics', description: 'Read-only analysis', rules: true }];
const group = { id: 'total', capability: 'analytics', metric: 'Revenue using the project definition', grain: 'scalar' };
const constraints = { period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' }, filters: ['exclude test orders'], requested_statuses: [] };
const plan = { name: 'plan_queries', args: { objective: 'Revenue', constraints, groups: [group] } };
const clarify = { name: 'clarify_intent', args: { question: 'Which metric and period?' } };

const modelConfig = { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', baseUrl: 'https://example.invalid/v1' };
const context = { conversation: [{ role: 'user', content: '營收，2026-01-01 含至 2026-01-19 不含，UTC，總額與每週' }], capabilities: caps, metadata: {}, timeoutMs: 1000 };
const wire = { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [
  { type: 'function', function: { name: 'resolve_intent', arguments: JSON.stringify(intentResponse(context.conversation)) } },
] } }] };

test('Nemotron transport sends only one configured model and parses actual tool calls', async () => {
  let request;
  const model = new NemotronPlanner(modelConfig, { apiKey: 'test-secret', fetchImpl: async (url, options) => {
    request = { url, options }; return Response.json(wire);
  } });
  assert.deepEqual(await model.decide(context), plannerContract.parse('resolve_intent', intentResponse(context.conversation), caps, context));
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.model, modelConfig.id);
  assert.equal(payload.chat_template_kwargs.enable_thinking, false);
  assert.equal(payload.tool_choice, 'auto');
  assert.equal(payload.parallel_tool_calls, false);
  assert.deepEqual(payload.messages.at(-1), context.conversation.at(-1));
  assert.equal(request.options.redirect, 'error');
  assert.equal(JSON.stringify(model.calls).includes('test-secret'), false);
  assert.throws(() => new NemotronPlanner({ ...modelConfig, id: 'gpt-6' }, { apiKey: 'x' }));
});

for (const failure of ['http', 'text', 'multiple', 'invalid_arguments', 'oversized']) test(`provider ${failure} fails closed without retry`, async () => {
  let calls = 0;
  const model = new NemotronPlanner(modelConfig, { apiKey: 'test-secret', fetchImpl: async () => {
    calls++; const body = structuredClone(wire);
    if (failure === 'http') return new Response('test-secret', { status: 401 });
    if (failure === 'text') body.choices[0].finish_reason = 'stop';
    if (failure === 'multiple') body.choices[0].message.tool_calls.push(body.choices[0].message.tool_calls[0]);
    if (failure === 'invalid_arguments') body.choices[0].message.tool_calls[0].function.arguments = 'not json';
    if (failure === 'oversized') return new Response('x'.repeat(128 * 1024 + 1));
    return Response.json(body);
  } });
  await assert.rejects(model.decide(context), /planner_failed/);
  assert.equal(calls, 1); assert.equal(JSON.stringify(model.calls).includes('test-secret'), false);
});

test('transport marks a timeout without issuing its own retry or exposing diagnostics', async () => {
  let calls=0;
  const model=new NemotronPlanner(modelConfig,{apiKey:'test-secret',fetchImpl:async()=>{
    calls++; throw new DOMException('test-secret','TimeoutError');
  }});
  await assert.rejects(model.decide(context),PlannerTimeout);
  assert.equal(calls,1); assert.equal(model.calls[0].failure_reason,'timeout');
  assert.equal(JSON.stringify(model.calls).includes('test-secret'),false);
});
