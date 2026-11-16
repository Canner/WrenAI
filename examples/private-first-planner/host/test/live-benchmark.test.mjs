import test from 'node:test';
import assert from 'node:assert/strict';
import { schedule, verifyCloudRequest } from '../live-benchmark.mjs';
import { fixturePayload } from '../../p2/broker.mjs';
import { briefs } from '../../p5/protocol.mjs';
import { digest } from '../../contracts.mjs';

test('live cohort preserves four cases twice in each route, without sharing private phases', () => {
  const entries = schedule(); assert.equal(entries.length, 24);
  assert.equal(new Set(entries.map(x => `${x.case.id}/${x.repeat}/${x.route}`)).size, 24);
  for (const mode of ['private-only', 'fixed-cloud', 'adaptive']) assert.equal(entries.filter(x => x.route === mode).length, 8);
});
test('live observer verifies exact approved projection and only sanitized repair requirements', () => {
  const bundle = { export_id: 'test', payload: fixturePayload, design_brief: briefs.executive_dashboard };
  const task = { export: bundle, approvals: [{ approve: true, request_digest: digest(bundle) }] };
  const prompt = { export_id: 'test', data_version: digest(fixturePayload), payload: fixturePayload, design_brief: briefs.executive_dashboard };
  const body = value => ({ messages: [{ content: [{ text: JSON.stringify(value) }] }] });
  assert.equal(verifyCloudRequest(body(prompt), task, 'executive_dashboard', 0), true);
  assert.equal(verifyCloudRequest(body({ ...prompt, design_brief: prompt.design_brief + '\nRepair checks: layout, contrast' }), task, 'executive_dashboard', 1), true);
  assert.throws(() => verifyCloudRequest(body({ ...prompt, private: 'PRIVATE_BENCHMARK_CANARY' }), task, 'executive_dashboard', 0));
  assert.throws(() => verifyCloudRequest(body({ ...prompt, design_brief: prompt.design_brief + '\nRepair checks: PRIVATE_ERROR' }), task, 'executive_dashboard', 1));
  assert.throws(() => verifyCloudRequest(body(prompt), { ...task, approvals: [] }, 'executive_dashboard', 0));
});
