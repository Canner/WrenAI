import assert from 'node:assert/strict';
import { TaskController } from './controller.mjs';
import { FakePlanner, FakeWren, FakeCloud, FakeExportBroker, ManualClock, makePlan } from './fakes.mjs';

async function scenario(name) {
  const config = { plan: makePlan(), planner: new FakePlanner(), wren: new FakeWren(),
    cloud: new FakeCloud(), broker: new FakeExportBroker(), clock: new ManualClock() };
  if (name === 'private_answer') config.plan = makePlan({ output: 'answer' });
  if (name === 'human_clarification') config.plan = makePlan({ status_scope: null });
  if (name === 'denied') config.broker = new FakeExportBroker({ datasets: [] });
  if (name === 'budget') config.limits = { calls: 3 };
  let entered;
  const pending = new Promise(resolve => { entered = resolve; });
  if (['cancel', 'timeout'].includes(name)) {
    config.cloud.design = (bundle, { signal }) => {
      config.cloud.requests.push(bundle); entered();
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
    };
  }
  const host = new TaskController(config);
  const running = host.run();
  if (['cancel', 'timeout'].includes(name)) {
    await pending;
    if (name === 'cancel') host.cancel(); else config.clock.advance(60_000);
  }
  let result = await running;
  let clarification = null;
  if (name === 'human_clarification') {
    assert.equal(result.state, 'waiting_for_user');
    clarification = { question: result.question.question, scripted_user_answer: 'paid' };
    result = await host.answer({ question_id: result.question.question_id,
      plan_revision: result.question.plan_revision, choice: 'paid' });
  }
  const expected = { denied: 'disclosure_denied', budget: 'budget_exhausted', cancel: 'cancelled', timeout: 'timeout' };
  if (Object.hasOwn(expected, name)) assert.equal(result.error, expected[name]);
  else assert.equal(result.state, 'completed');
  assert.equal(config.wren.activeSessions, 0);
  assert.equal(config.clock.pendingTimers, 0);
  return { scenario: name, state: result.state, error: result.error, clarification,
    usage: result.usage, cloud_requests: config.cloud.requests.length,
    states: result.events.map(e => e.state), output_kind: result.output?.kind ?? null };
}

for (const name of ['dashboard', 'private_answer', 'human_clarification', 'denied', 'budget', 'cancel', 'timeout'])
  console.log(JSON.stringify(await scenario(name)));
