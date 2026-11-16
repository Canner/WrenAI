import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { behaviors } from '../../behaviors/index.mjs';
import { admitBehaviors, loadBehaviors, sha256 } from '../../behaviors/artifact.mjs';
import { plannerContract } from '../intent-planning.mjs';
import { NemotronPlanner } from '../../p1/model.mjs';
import { NemotronDesigner } from '../private-design.mjs';
import { PrivateSession } from '../../p1/session.mjs';
import { parse } from '../../p2/planning.mjs';
import { FixtureBroker, fixturePayload } from '../../p2/broker.mjs';
import { designDashboard } from '../../p2/design.mjs';
import { designPrompt, ClaudeCode } from '../../p2/claude.mjs';
import { designSchema } from '../../p2/contracts.mjs';
import { schedule, route } from '../protocol.mjs';
import { EvidenceLease } from '../evidence.mjs';
import { digest } from '../../contracts.mjs';

const root = fileURLToPath(new URL('../../behaviors/', import.meta.url));
const golden = JSON.parse(readFileSync(new URL('./behavior-baseline.json', import.meta.url)));
const hash = value => sha256(typeof value === 'string' ? value : JSON.stringify(value));
const clone = structuredClone;
const config = { id: 'nvidia/nemotron-test', baseUrl: 'https://test.invalid' };
const response = (name, args) => Response.json({ choices: [{ finish_reason: 'tool_calls', message: {
  tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(args) } }],
} }] });
const spec = b => ({ version: 1, export_id: b.export_id, data_version: b.data_version,
  theme: 'ivory', accent: 'violet', layout: 'hero', cards: [
    { dataset_id: 'revenue_total', kind: 'kpi', title: 'Total revenue' },
    { dataset_id: 'revenue_weekly', kind: 'line', title: 'Weekly revenue' },
  ] });

test('compiled behavior prompts and host schemas match pre-extraction model contracts', () => {
  assert.equal(hash(plannerContract.systemPrompt), golden.planner_prompt);
  assert.equal(hash(plannerContract.tools), golden.planner_tools);
  assert.equal(hash(designPrompt), golden.design_prompt);
  assert.equal(hash(designSchema), golden.design_schema);
  assert.equal(plannerContract.systemPrompt, behaviors.resolve_intent.prompt);
  assert.equal(designPrompt, behaviors.design_dashboard.prompt);
  assert.ok(Object.isFrozen(behaviors.design_dashboard));
});

test('unsupported IR behavior cannot silently fall back to prompt-only execution', () => {
  const original = JSON.parse(readFileSync(join(root, 'compiled/ir.json')));
  assert.equal(admitBehaviors(original).resolve_intent.tier, 'cheap');
  for (const mutate of [
    x => x.warble_ir_version = '1.0',
    x => x.components.pop(),
    x => x.components.push(clone(x.components[0])),
    x => x.config.model = 'other',
    x => x.components[0].borrowed_actions.push('run_sql'),
    x => x.components[0].guardrails = [],
    x => x.components[0].llm_calls.push(clone(x.components[0].llm_calls[0])),
    x => x.components[0].llm_calls[0].when = { kind: 'custom' },
    x => x.components[1].required_capabilities.push('data_write'),
    x => x.components[1].effect.render_blocks.push('chart'),
  ]) { const ir = clone(original); mutate(ir); assert.throws(() => admitBehaviors(ir), /unsupported_behavior_contract/); }
});

test('changed prompts, profile, new files and compiled IR require regeneration', () => {
  for (const [path, text] of [
    ['profile/components/resolve_intent/respond.md', 'different instructions'],
    ['profile/profile.yml', 'profile: different'], ['profile/new.yml', 'unexpected: true'],
    ['compiled/ir.json', '{}'],
  ]) {
    const dir = mkdtempSync(join(tmpdir(), 'behavior-drift-'));
    try {
      cpSync(root, dir, { recursive: true });
      assert.equal(loadBehaviors(dir).components.design_dashboard.prompt, designPrompt);
      writeFileSync(join(dir, path), text);
      assert.throws(() => loadBehaviors(dir), /stale_behavior_artifact/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('actual private design request uses compiled instructions with unchanged tool envelope', async () => {
  const b = { export_id: '00000000-0000-0000-0000-000000000001', data_version: digest(fixturePayload), payload: fixturePayload };
  let sent, authorized = false;
  const designer = new NemotronDesigner(config, { apiKey: 'test', fetchImpl: async (_, options) => {
    assert.equal(authorized, true); sent = JSON.parse(options.body); return response('design_dashboard', spec(b));
  } });
  await designer.design(b, { timeoutMs: 1000, beforeSend: async () => { authorized = true; } });
  assert.equal(hash(sent.messages[0].content), golden.private_design_prompt);
  assert.deepEqual(sent.tools, [{ type: 'function', function: {
    name: 'design_dashboard', description: 'Return the final dashboard design.', parameters: designSchema,
  } }]);
  assert.deepEqual(JSON.parse(sent.messages.at(-1).content), b);
});

test('actual Claude launcher consumes compiled design prompt and unchanged schema', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'behavior-cli-')), command = join(dir, 'cli');
  const code = `#!${process.execPath}\nif(process.argv.includes('--version')){console.log('2.1.309 (Claude Code)');process.exit(0);}
    const {createHash}=await import('node:crypto');
    const hash=x=>createHash('sha256').update(x).digest('hex');
    const args=process.argv; if(hash(args[args.indexOf('--system-prompt')+1])!==${JSON.stringify(golden.design_prompt)}
      ||hash(args[args.indexOf('--json-schema')+1])!==${JSON.stringify(golden.design_schema)})process.exit(1);
    let input='';for await(const c of process.stdin)input+=c;const b=JSON.parse(input);
    console.log(JSON.stringify({type:'result',subtype:'success',structured_output:(${spec.toString()})(b)}));`;
  writeFileSync(command, code, { mode: 0o700 });
  try {
    const cloud = new ClaudeCode({ command, model: 'test', baseUrl: 'http://127.0.0.1:1' }, { apiKey: 'test' });
    const b = { export_id: '00000000-0000-0000-0000-000000000001', data_version: digest(fixturePayload), payload: fixturePayload, recipient: cloud.recipient };
    assert.deepEqual((await cloud.design(b)).spec, spec(b));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('same eight P4 cases traverse compiled planner, clarification, host routing and authorized design offline', async () => {
  const evidence = {
    mandatory_scope: { kind: 'project_defaults', declared_defaults_enforced: true }, checks_summary: 'all_satisfied',
    applied_period: { lower: '2026-01-01', upper: '2026-01-19', lower_inclusive: true, upper_inclusive: false },
    checks: { 'exclude-test-orders': { result: 'satisfied' }, 'count-paid-and-shipped': { result: 'satisfied' } },
    observed: { aggregated: true, models: ['orders'], columns: { orders: ['amount', 'is_test', 'order_date', 'status'] },
      joins: [], status_literals: { 'orders.status': ['paid', 'shipped'] } }, unverified: ['fiscal_calendar_bounds'],
  };
  for (const entry of schedule()) {
    let revision = 0, plannerCalls = 0;
    const results = fixturePayload.datasets.map(d => ({ kind: 'table', timezone: 'UTC',
      columns: d.columns.map((_, i) => ({ key: `c${i}`, label: 'PRIVATE_LABEL' })),
      rows: d.rows.map(row => Object.fromEntries(d.columns.map((k, i) => [`c${i}`, row[k]]))),
    }));
    const port = { async call(name, args) {
      if (name === 'capabilities') return { capabilities: [{ id: 'analytics' }] };
      if (name === 'open_session') return { session_id: 'private', revision };
      if (name === 'close_session') return { status: 'closed' };
      if (name === 'get_evidence') return { result: results[Number(args.request.evidence_ref.slice(1))], evidence };
      assert.equal(name, 'ask_data'); assert.equal(args.request.expected_revision, revision);
      const i = revision++; return { status: 'completed', revision, result_ref: `r${i}`, evidence_ref: `e${i}`, result: results[i] };
    } };
    const model = new NemotronPlanner(config, { apiKey: 'test', decisionContract: plannerContract, fetchImpl: async (_, options) => {
      const sent = JSON.parse(options.body); plannerCalls++;
      assert.equal(hash(sent.messages[0].content), golden.planner_prompt);
      assert.equal(hash(sent.tools), golden.planner_tools);
      const missing = entry.case.clarify && plannerCalls === 1;
      return response('resolve_intent', { metrics: missing ? [] : [{ quote: '營收', definition: 'Sum order amounts in USD, non-test paid/shipped' }],
        period: missing ? null : { quotes: ['2026-01-01', '2026-01-19'], ...fixturePayload.period },
        objective: 'Revenue', filters: [], requested_statuses: [], groups: missing ? [] : [
          { id: 'overall', capability: 'analytics', quote: '總營收', metric_index: 0, grain: 'scalar' },
          { id: 'weekly', capability: 'analytics', quote: '按週營收', metric_index: 0, grain: 'week' },
        ], presentation: entry.case.expected_route, unsupported_reason: null });
    } });
    const session = new PrivateSession({ port, model, parseDecision: parse });
    try {
      let state = await session.start(entry.case.question);
      if (entry.case.clarify) {
        assert.equal(state.state, 'waiting_for_user'); assert.equal(revision, 0);
        state = await session.answer({ question_id: state.pending.id, plan_revision: state.pending.plan_revision, answer: entry.case.human_answers[0] });
      }
      assert.equal(state.state, 'completed'); assert.equal(plannerCalls, entry.case.clarify ? 2 : 1);
      const lease = new EvidenceLease(port, state, Date.now() + 10_000);
      for (const mode of entry.order) {
        const provider = route(mode, state.plans.at(-1).presentation);
        const cloud = provider === 'nemotron' ? new NemotronDesigner(config, { apiKey: 'test', fetchImpl: async (_, options) => {
          const b = JSON.parse(JSON.parse(options.body).messages.at(-1).content); return response('design_dashboard', spec(b));
        } }) : { recipient: 'fake-cloud', async design(b, { beforeSend }) { await beforeSend(); return { spec: spec(b) }; } };
        const events = [];
        const broker = new FixtureBroker({ session: lease, recipient: cloud.recipient, requireDesignProposal: false, verifySource: async () => true, audit: async e => events.push(e) });
        const result = await designDashboard({ broker, cloud });
        assert.equal(result.state, 'completed'); assert.match(result.html, /\$770/);
        assert.deepEqual(events.map(e => e.event), ['send', 'send', 'use']);
        assert.equal(JSON.stringify(result.bundle).includes('PRIVATE_'), false);
      }
    } finally { await session.close(); }
  }
});
