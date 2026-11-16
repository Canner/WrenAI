import test from 'node:test';
import assert from 'node:assert/strict';
import { PrivateSession } from '../session.mjs';
import { NemotronPlanner, PlannerTimeout } from '../model.mjs';
import { parsePlanDecision } from '../planning.mjs';
import { scoreFlow } from '../run.mjs';
import { scoreData } from '../scoring.mjs';
import { validateResultGrain } from '../retrieval.mjs';

const caps = [{ id: 'analytics', description: 'Read-only analysis', rules: true }];
const group = { id: 'total', capability: 'analytics', metric: 'Revenue using the project definition', grain: 'scalar' };
const constraints = { period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' }, filters: ['exclude test orders'], requested_statuses: [] };
const plan = { name: 'plan_queries', args: { objective: 'Revenue', constraints, groups: [group] } };
const clarify = { name: 'clarify_intent', args: { question: 'Which metric and period?' } };
function fakePort({ clarification = false, denied = false, stale = false, evidenceMismatch = false, wrongShape = false } = {}) {
  let revision = 0; const stored = new Map(), calls = [];
  return { calls, async call(name, args) {
    calls.push({ name, args });
    if (name === 'capabilities') return { capabilities: caps, metadata_documents: [{ id: 'rules' }] };
    if (name === 'open_session') return { session_id: 'session', revision };
    if (name === 'close_session') return { status: 'closed' };
    if (name === 'read_metadata') return { documents: [{ id: 'rules', text: 'Revenue is in USD.' }] };
    if (name === 'get_evidence') return { result: evidenceMismatch ? {} : stored.get(args.request.evidence_ref), evidence: { checks_summary: 'all_satisfied' } };
    assert.equal(args.request.session_id, 'session');
    assert.equal(args.request.expected_revision, revision);
    if (denied) return { status: 'denied' };
    revision++;
    if (clarification && name === 'ask_data') return { status: 'needs_clarification', revision, question: 'Confirm order statuses', continuation_ref: 'continue-real' };
    if (name === 'continue_task') assert.equal(args.request.continuation_ref, 'continue-real');
    const weekly = args.request.question?.includes('Grain: week');
    const result = weekly || wrongShape
      ? { kind: 'table', columns: [{ key: 'c0', label: 'Week' }, { key: 'c1', label: 'Revenue' }], rows: [{ c0: '2026-01-05T00:00:00', c1: 220 }] }
      : { kind: 'table', columns: [{ key: 'c0', label: 'Revenue' }], rows: [{ c0: 770 }] };
    stored.set(`e${revision}`, result);
    return { status: 'completed', revision: stale ? 0 : revision, result, result_ref: `r${revision}`, evidence_ref: `e${revision}` };
  } };
}
function make(port, decisions = [plan]) {
  let index = 0;
  const contexts = [];
  const model = { async decide(context) {
    contexts.push(structuredClone(context)); const decision = decisions[index++];
    if (decision instanceof Error) throw decision;
    return decision;
  } };
  return { session: new PrivateSession({ port, model }), contexts };
}

test('real-wire-shaped data calls use host IDs and revisions, fetch evidence and close', async () => {
  const port = fakePort(), { session } = make(port);
  const snapshot = await session.start('January revenue?');
  assert.equal(snapshot.state, 'completed');
  assert.deepEqual(snapshot.results[0].result.rows, [{ c0: 770 }]);
  const request = port.calls.find(c => c.name === 'ask_data').args.request;
  assert.equal(request.expected_revision, 0);
  assert.ok(request.question.startsWith(`Metric: ${group.metric}`));
  assert.match(request.question, /Grain: scalar/);
  assert.match(request.question, /2026-01-01 inclusive to 2026-01-19 exclusive, UTC/);
  assert.deepEqual(Object.keys(request).sort(), ['capability', 'expected_revision', 'question', 'request_id', 'session_id']);
  assert.equal(port.calls.some(c => c.name === 'run_sql'), false);
  await session.close(); assert.equal(port.calls.at(-1).name, 'close_session');
});

test('planner ambiguity pauses before querying and uses actual human answer', async () => {
  const port = fakePort(), { session, contexts } = make(port, [clarify, plan]);
  const waiting = await session.start('How are things?');
  assert.equal(waiting.state, 'waiting_for_user');
  assert.equal(port.calls.some(c => c.name === 'ask_data'), false);
  await assert.rejects(session.answer({ question_id: 'fake', plan_revision: 0, answer: 'Revenue' }));
  const result = await session.answer({ question_id: waiting.pending.id, plan_revision: 0, answer: 'Revenue January 2026' });
  assert.equal(result.state, 'completed'); assert.equal(result.plan_revision, 1);
  assert.equal(contexts[1].conversation.at(-1).content, 'Revenue January 2026');
  assert.equal(result.service_revision, 1);
  await session.close();
});

test('service clarification only resumes with saved opaque ref and actual answer', async () => {
  const port = fakePort({ clarification: true }), { session, contexts } = make(port);
  const waiting = await session.start('All order statuses');
  assert.equal(waiting.pending.source, 'wren'); assert.equal(waiting.service_revision, 1);
  assert.equal(waiting.results.length, 0);
  assert.equal(port.calls.some(c => c.name === 'continue_task'), false);
  const result = await session.answer({ question_id: waiting.pending.id, plan_revision: 0, answer: 'paid shipped cancelled pending' });
  assert.equal(result.state, 'completed'); assert.equal(result.service_revision, 2);
  assert.equal(contexts.length, 1); // no model manufactures an answer to Wren
  const req = port.calls.find(c => c.name === 'continue_task').args.request;
  assert.equal(req.answer, 'paid shipped cancelled pending'); assert.equal(req.expected_revision, 1);
  await session.close();
});

test('multiple grains execute sequentially in one session', async () => {
  const port = fakePort();
  const two = { name: 'plan_queries', args: { objective: 'Revenue', constraints, groups: [group, { ...group, id: 'trend', grain: 'week' }] } };
  const { session } = make(port, [two]);
  const s = await session.start('Total and weekly');
  assert.equal(s.results.length, 2);
  assert.deepEqual(port.calls.filter(c => c.name === 'ask_data').map(c => c.args.request.expected_revision), [0, 1]);
  assert.equal(port.calls.filter(c => c.name === 'open_session').length, 1);
  assert.deepEqual(scoreFlow(s, { groups: 2, grains: ['scalar', 'week'], planner_clarification: false }),
    { completed: true, group_count: true, grains: true, planner_clarification: true, wren_clarification: null });
  await session.close();
});

for (const fault of ['denied', 'stale', 'evidenceMismatch']) test(`${fault} never becomes a bound answer or retry`, async () => {
  const port = fakePort({ [fault]: true }), { session } = make(port);
  const s = await session.start('Revenue');
  assert.equal(s.state, 'failed'); assert.equal(s.results.length, 0);
  assert.equal(port.calls.filter(c => c.name === 'ask_data').length, 1);
  await session.close();
});

test('unsupported task makes no data request', async () => {
  const port = fakePort(), { session } = make(port, [{ name: 'unsupported', args: { reason: 'No design capability' } }]);
  assert.equal((await session.start('Design a dashboard')).state, 'unsupported');
  assert.equal(port.calls.some(c => c.name === 'ask_data'), false); await session.close();
});

test('decision schema rejects invented capabilities, routing, duplicate IDs and extra fields', () => {
  assert.throws(() => parsePlanDecision('delegate_cloud', {}, caps));
  for (const bad of [{ ...group, capability: 'sql' }, { ...group, model: 'gpt' }, { ...group, grain: 'everything' }])
    assert.throws(() => parsePlanDecision('plan_queries', { objective: 'x', constraints, groups: [bad] }, caps));
  assert.throws(() => parsePlanDecision('plan_queries', { objective: 'x', constraints, groups: [group, group] }, caps));
});

const modelConfig = { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', baseUrl: 'https://example.invalid/v1' };
const context = { conversation: [{ role: 'user', content: 'Revenue?' }], capabilities: caps, metadata: {}, timeoutMs: 1000 };
const wire = { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [
  { type: 'function', function: { name: plan.name, arguments: JSON.stringify(plan.args) } },
] } }] };

test('Nemotron transport sends only one configured model and parses actual tool calls', async () => {
  let request;
  const model = new NemotronPlanner(modelConfig, { apiKey: 'test-secret', fetchImpl: async (url, options) => {
    request = { url, options }; return Response.json(wire);
  } });
  assert.deepEqual(await model.decide(context), plan);
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

test('oracle rejects wrong values or date bounds even when the service says completed', () => {
  const expected = { groups: 1, scalar: 770 };
  const snapshot = { state: 'completed', results: [{ group,
    result: { kind: 'table', timezone: 'UTC', columns: [{ key: 'c9', label: 'Amount' }], rows: [{ c9: 770 }] },
    evidence: { applied_period: { lower: '2026-01-01', upper: '2026-01-19', lower_inclusive: true, upper_inclusive: false } },
  }] };
  assert.equal(scoreData(snapshot, expected).passed, true);
  snapshot.results[0].result.rows[0].c9 = 1550;
  assert.equal(scoreData(snapshot, expected).passed, false);
  snapshot.results[0].result.rows[0].c9 = 770;
  snapshot.results[0].evidence.applied_period.lower = '2026-01-01T00:00:00';
  snapshot.results[0].evidence.applied_period.upper = '2026-01-19T00:00:00';
  assert.equal(scoreData(snapshot, expected).passed, true);
  snapshot.results[0].evidence.applied_period.lower = '2026-01-01T01:00:00';
  assert.equal(scoreData(snapshot, expected).passed, false);
  snapshot.results[0].evidence.applied_period.lower = '2026-01-01T00:00:00';
  snapshot.results[0].result.timezone = 'Asia/Taipei';
  assert.equal(scoreData(snapshot, expected).passed, false);
  snapshot.results[0].result.timezone = 'UTC';
  snapshot.results[0].evidence.applied_period.upper = '2026-01-20';
  assert.equal(scoreData(snapshot, expected).passed, false);
  assert.equal(scoreData({ results: [] }, expected).passed, false);
});


test('mixed request is never appended to a scalar subtask; each group carries structured conditions', async () => {
  const port = fakePort(), { session } = make(port);
  await session.start('Total revenue AND weekly trend; also original user text');
  const q = port.calls.find(c => c.name === 'ask_data').args.request.question;
  assert.ok(q.startsWith(`Metric: ${group.metric}`));
  assert.equal(q.includes('weekly trend'), false);
  assert.ok(q.includes('Shared filters: exclude test orders'));
  await session.close();
});

test('service completed with wrong grain is rejected before result binding', async () => {
  const port = fakePort({ wrongShape: true }), { session } = make(port);
  const s = await session.start('Total revenue');
  assert.equal(s.state, 'failed'); assert.equal(s.error, 'result_grain_mismatch');
  assert.equal(s.results.length, 0); assert.equal(s.service_revision, 1);
  assert.equal(port.calls.filter(c => c.name === 'ask_data').length, 1);
  await session.close();
});

test('weekly gate rejects observed time-of-day splits, duplicate weeks and extra columns', () => {
  const result = { kind: 'table', columns: [{key:'d'}, {key:'v'}], rows: [{d:'2025-12-29T00:00:00',v:50},{d:'2026-01-05T00:00:00',v:220}] };
  assert.equal(validateResultGrain(result, 'week'), true);
  for (const rows of [[{d:'2026-01-05T23:59:59',v:220}], [{d:'2026-01-06',v:220}], [{d:'2026-01-05',v:100},{d:'2026-01-05',v:120}]])
    assert.equal(validateResultGrain({...result,rows}, 'week'), false);
  assert.equal(validateResultGrain({...result,columns:[...result.columns,{key:'extra'}]}, 'week'), false);
  assert.equal(validateResultGrain(result, 'scalar'), false);
});

test('planner period contract rejects missing, reversed or invalid dates', () => {
  for (const period of [null,{lower:'2026-01-20',upper:'2026-01-19',timezone:'UTC'}, {lower:'2026-02-30',upper:'2026-03-02',timezone:'UTC'}])
    assert.throws(() => parsePlanDecision('plan_queries', {...plan.args,constraints:{...constraints,period}},caps));
});

test('open-ended clarification has one question, without generated option lists', () => {
  assert.deepEqual(parsePlanDecision('clarify_intent', { question: 'Which metric and period?' }, caps), clarify);
  assert.throws(() => parsePlanDecision('clarify_intent', { question: 'Which metric?', options: ['A', 'B'] }, caps));
});

test('upstream timeout stays unavailable and triggers no retry or bound result', async () => {
  const port = fakePort(), original = port.call;
  port.call = async (name, args) => {
    if (name === 'ask_data') { port.calls.push({ name, args }); return { status: 'unavailable', reason: 'timeout' }; }
    return original(name, args);
  };
  const { session } = make(port), s = await session.start('Total revenue');
  assert.equal(s.state, 'failed'); assert.deepEqual(s.error, { upstream_status: 'unavailable', reason: 'timeout' });
  assert.equal(s.results.length, 0); assert.equal(port.calls.filter(c => c.name === 'ask_data').length, 1);
  await session.close();
});


test('explicit status set travels separately from the metric and is not manufactured confirmation', async () => {
  const port = fakePort({clarification:true});
  const requested = ['paid','shipped','cancelled','pending'];
  const decision = {...plan,args:{...plan.args,constraints:{...constraints,requested_statuses:requested}}};
  const {session}=make(port,[decision]);
  const s=await session.start('All four statuses');
  const q=port.calls.find(c=>c.name==='ask_data').args.request.question;
  assert.match(q,/paid, shipped, cancelled, pending/);
  assert.match(q,/not a status confirmation/);
  assert.equal(s.state,'waiting_for_user');
  assert.equal(port.calls.some(c=>c.name==='continue_task'),false);
  assert.throws(()=>parsePlanDecision('plan_queries',{...plan.args,constraints:{...constraints,requested_statuses:['paid','paid']}},caps));
  await session.close();
});

test('one planner timeout can retry before any data mutation and consumes attempt budget', async () => {
  const port=fakePort(), {session,contexts}=make(port,[new PlannerTimeout(),plan]);
  const s=await session.start('Total revenue');
  assert.equal(s.state,'completed'); assert.equal(s.usage.planner,2);
  assert.equal(contexts.length,2); assert.deepEqual(contexts[0].conversation,contexts[1].conversation);
  assert.equal(s.trace.filter(t=>t.name==='planner_retry').length,1);
  assert.equal(port.calls.filter(c=>c.name==='ask_data').length,1);
  await session.close();
});

test('repeated planner timeout stops after one retry without querying', async () => {
  const port=fakePort(), {session,contexts}=make(port,[new PlannerTimeout(),new PlannerTimeout(),plan]);
  const s=await session.start('Total revenue');
  assert.equal(s.state,'failed'); assert.equal(contexts.length,2);
  assert.equal(port.calls.some(c=>c.name==='ask_data'),false);
  await session.close();
});

test('planner timeout retry after clarification still fits the three-attempt case limit', async () => {
  const port=fakePort(), {session}=make(port,[clarify,new PlannerTimeout(),plan]);
  const waiting=await session.start('How are things?');
  const s=await session.answer({question_id:waiting.pending.id,plan_revision:0,answer:'Revenue in January'});
  assert.equal(s.state,'completed'); assert.equal(s.usage.planner,3);
  await session.close();
});

test('planner HTTP or schema failure does not trigger the timeout retry', async () => {
  const port=fakePort(), {session,contexts}=make(port,[Error('planner_failed'),plan]);
  assert.equal((await session.start('Revenue')).state,'failed');
  assert.equal(contexts.length,1); assert.equal(port.calls.some(c=>c.name==='ask_data'),false);
  await session.close();
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
