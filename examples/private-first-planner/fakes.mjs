// Offline synthetic adapters only. No environment credentials, transport or model SDK.
import { randomUUID } from 'node:crypto';
import { DisclosureDenied, digest, immutable, parseContract, requireThat } from './contracts.mjs';

export const PRIVATE_CANARY = 'PRIVATE_ONLY_CANARY';
export function makePlan(overrides = {}) {
  return parseContract('TaskPlan', {
    version: 1, task_id: randomUUID(), revision: 0,
    objective: `Build a dashboard. Private note: ${PRIVATE_CANARY}`,
    metric: 'revenue', period: '2026-Q3', status_scope: 'paid', theme: null,
    output: 'dashboard', ...overrides,
  });
}
export function aggregate(scope = 'paid') {
  return immutable({
    id: `revenue-${scope}`, version: 1, metric: 'revenue', period: '2026-Q3',
    status_scope: scope, unit: 'USD', grain: 'month',
    columns: [{ key: 'month', label: 'Month', type: 'string' }, { key: 'revenue', label: 'Revenue', type: 'number' }],
    rows: [{ month: '2026-07', revenue: scope === 'paid' ? 100 : 130 },
      { month: '2026-08', revenue: 200 }, { month: '2026-09', revenue: 300 }],
  });
}

export class FakePlanner {
  calls = [];
  async next(context, { signal }) {
    signal.throwIfAborted(); this.calls.push(context);
    if (context.plan.status_scope === null) return { action: 'clarify', field: 'status_scope' };
    if (!context.has_result) return { action: 'query_private' };
    return context.plan.output === 'dashboard'
      ? { action: 'delegate_cloud', capability: 'dashboard_design' } : { action: 'respond' };
  }
}

// Deliberately a small consumer port, not a pretend implementation of Wren MCP.
export class FakeWren {
  #sessions = new Map();
  calls = [];
  async open({ signal }) {
    signal.throwIfAborted();
    const id = randomUUID(); this.#sessions.set(id, { revision: 0, result: null, continuation: null });
    this.calls.push({ method: 'open', id }); return { id, revision: 0 };
  }
  #session(request) {
    const session = this.#sessions.get(request.session_id);
    requireThat(session && session.revision === request.expected_revision);
    return session;
  }
  #complete(request, session) {
    requireThat(['paid', 'all'].includes(request.status_scope));
    const result = immutable({ kind: 'completed', session_id: request.session_id,
      revision: ++session.revision, result_ref: randomUUID(), dataset: aggregate(request.status_scope),
      private_details: { sql: `SELECT '${PRIVATE_CANARY}'`, raw_rows: [{ email: PRIVATE_CANARY }], metadata: PRIVATE_CANARY },
    });
    session.result = result; return result;
  }
  async ask(request, { signal }) {
    signal.throwIfAborted(); const session = this.#session(request);
    this.calls.push({ method: 'ask', request: immutable(request) });
    if (request.status_scope === null) {
      session.continuation = randomUUID();
      return { kind: 'needs_clarification', session_id: request.session_id, revision: ++session.revision,
        field: 'status_scope', continuation_ref: session.continuation };
    }
    return this.#complete(request, session);
  }
  async continue(request, { signal }) {
    signal.throwIfAborted(); const session = this.#session(request);
    requireThat(session.continuation && request.continuation_ref === session.continuation
      && request.answer === request.status_scope);
    this.calls.push({ method: 'continue', request: immutable(request) });
    session.continuation = null; return this.#complete(request, session);
  }
  isCurrent(result) {
    const session = this.#sessions.get(result.session_id);
    return !!session?.result && session.revision === result.revision && digest(session.result) === digest(result);
  }
  invalidate() { for (const session of this.#sessions.values()) session.revision++; }
  close(id) { this.calls.push({ method: 'close', id }); this.#sessions.delete(id); }
  get activeSessions() { return this.#sessions.size; }
}

// Fixture-only authority: exact synthetic dataset grants, immutable issued receipts.
// This does not infer aggregation, deidentify data, or replace production policy.
export class FakeExportBroker {
  #grants; #issued = new Map(); #version = 1; #revoked = false; #ttl;
  audit = [];
  constructor({ datasets = [aggregate('paid'), aggregate('all')], ttlMs = 30_000 } = {}) {
    requireThat(Number.isSafeInteger(ttlMs) && ttlMs > 0);
    this.#grants = new Set(datasets.map(digest)); this.#ttl = ttlMs;
  }
  revoke() { this.#revoked = true; this.#version++; }
  #allow(dataset, recipient) {
    if (this.#revoked || recipient !== 'fake-designer' || !this.#grants.has(digest(dataset))) throw new DisclosureDenied();
  }
  issue({ plan, dataset, recipient, purpose, now }) {
    this.#allow(dataset, recipient);
    requireThat(dataset.status_scope === plan.status_scope && dataset.period === plan.period && dataset.metric === plan.metric);
    // The private objective and Wren diagnostics never participate in the payload.
    const payload = { brief: 'Design a revenue dashboard using only the supplied monthly aggregate.',
      theme: plan.theme ?? 'light', dataset };
    const bundle = parseContract('ExportBundle', { version: 1, export_id: randomUUID(),
      task_id: plan.task_id, plan_revision: plan.revision, recipient, purpose,
      policy_version: this.#version, expires_at: now + this.#ttl, payload_digest: digest(payload), payload });
    this.#issued.set(bundle.export_id, digest(bundle)); return bundle;
  }
  authorize(bundle, now) {
    this.#allow(bundle.payload.dataset, bundle.recipient);
    if (bundle.expires_at <= now || bundle.policy_version !== this.#version
      || this.#issued.get(bundle.export_id) !== digest(bundle)) throw new DisclosureDenied();
    this.audit.push(immutable({ export_id: bundle.export_id, digest: bundle.payload_digest,
      recipient: bundle.recipient, policy_version: bundle.policy_version }));
    return true;
  }
}

export function design(bundle) {
  return { version: 1, task_id: bundle.task_id, plan_revision: bundle.plan_revision,
    export_id: bundle.export_id, theme: bundle.payload.theme, layout: 'grid',
    charts: [{ kind: 'bar', dataset_id: bundle.payload.dataset.id,
      dataset_version: bundle.payload.dataset.version, x: 'month', y: 'revenue', title: 'Monthly revenue' }] };
}
export class FakeCloud {
  requests = [];
  async design(bundle, { signal }) {
    signal.throwIfAborted(); this.requests.push(immutable(bundle)); return design(bundle);
  }
}

export class ManualClock {
  #time = 0; #timers = new Map(); #next = 0;
  now = () => this.#time;
  setTimer = (fn, ms) => { const id = ++this.#next; this.#timers.set(id, { at: this.#time + ms, fn }); return id; };
  clearTimer = (id) => { this.#timers.delete(id); };
  advance(ms) {
    requireThat(Number.isSafeInteger(ms) && ms >= 0);
    const end = this.#time + ms;
    while (true) {
      const next = [...this.#timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.#time = next[1].at; this.#timers.delete(next[0]); next[1].fn();
    }
    this.#time = end;
  }
  get pendingTimers() { return this.#timers.size; }
}
