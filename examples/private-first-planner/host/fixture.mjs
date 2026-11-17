import { randomUUID } from 'node:crypto';
import { digest, immutable, requireThat, DisclosureDenied } from '../contracts.mjs';
import { validateResultGrain } from '../worker/retrieval.mjs';

// This is an explicit public SYNTHETIC FIXTURE grant, not a general data classifier.
// The operator verifies the fixture files; Wren supplies host-derived evidence.
// Unknown datasets/values/scope are denied even if an LLM calls them aggregate.
export const fixturePayload = immutable({
  brief: 'Design an executive revenue dashboard. Use only the supplied aggregates. No additional metrics or narrative claims.',
  period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' },
  unit: 'USD', scope: 'Approved project defaults; synthetic demonstration data.',
  datasets: [
    { id: 'revenue_total', grain: 'scalar', columns: ['revenue'], rows: [{ revenue: 770 }] },
    { id: 'revenue_weekly', grain: 'week', columns: ['week','revenue'], rows: [
      { week: '2025-12-29', revenue: 50 }, { week: '2026-01-05', revenue: 220 }, { week: '2026-01-12', revenue: 500 },
    ] },
  ],
});
function day(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:Z|\+00:00)?)?$/.test(value) ? value.slice(0,10) : null; }
export function projectFixture(snapshot, { requireDesignProposal = true } = {}) {
  requireThat(snapshot.state === 'completed' && snapshot.results.length === 2);
  const plan = snapshot.plans.at(-1);
  requireThat((!requireDesignProposal || plan.presentation === 'dashboard_design') && plan.constraints.period.lower === '2026-01-01'
    && plan.constraints.period.upper === '2026-01-19' && plan.constraints.period.timezone === 'UTC'
    && plan.constraints.filters.length === 0
    && (plan.constraints.requested_statuses.length === 0 || [...plan.constraints.requested_statuses].sort().join(',') === 'paid,shipped'));
  const datasets = [];
  for (const item of snapshot.results) {
    const {result:r,evidence:e,group:g} = item;
    requireThat(item.plan_revision === snapshot.plan_revision && validateResultGrain(r,g.grain)
      && r.timezone === 'UTC' && e.observed?.aggregated === true
      && e.mandatory_scope?.kind === 'project_defaults' && e.mandatory_scope.declared_defaults_enforced === true
      && e.checks_summary === 'all_satisfied' && day(e.applied_period?.lower) === '2026-01-01'
      && day(e.applied_period?.upper) === '2026-01-19' && e.applied_period.lower_inclusive === true
      && e.applied_period.upper_inclusive === false
      && JSON.stringify(e.observed.models) === '["orders"]' && e.observed.joins.length === 0
      && [...e.observed.columns.orders].sort().join(',') === 'amount,is_test,order_date,status'
      && [...e.observed.status_literals['orders.status']].sort().join(',') === 'paid,shipped'
      && e.checks['exclude-test-orders']?.result === 'satisfied'
      && e.checks['count-paid-and-shipped']?.result === 'satisfied'
      && (e.unverified ?? []).every(x => x === 'fiscal_calendar_bounds'));
    const keys = r.columns.map(c=>c.key);
    if (g.grain === 'scalar') datasets.push({ id: 'revenue_total', grain:'scalar', columns:['revenue'], rows:r.rows.map(row=>({ revenue:row[keys[0]] })) });
    else {
      const x = keys.find(k=>typeof r.rows[0]?.[k] === 'string'), y=keys.find(k=>k!==x);
      datasets.push({ id:'revenue_weekly', grain:'week', columns:['week','revenue'], rows:r.rows.map(row=>({week:day(row[x]),revenue:row[y]})) });
    }
  }
  datasets.sort((a,b)=>a.id.localeCompare(b.id));
  const payload = { ...fixturePayload, datasets };
  // Equality is intentional: this grant permits only this known public fixture.
  requireThat(digest(payload) === digest(fixturePayload));
  return immutable(payload);
}
export class FixtureBroker {
  #session; #source; #audit; #clock; #recipient; #requireProposal; #revoked=false; #bundles=new Map();
  constructor({ session, verifySource, audit, recipient, now=Date.now, requireDesignProposal=true }) {
    requireThat(typeof verifySource === 'function' && typeof audit === 'function' && typeof recipient === 'string' && recipient.length > 0);
    this.#session=session; this.#source=verifySource; this.#audit=audit; this.#recipient=recipient; this.#clock=now; this.#requireProposal=requireDesignProposal;
  }
  revoke() { this.#revoked=true; }
  async #current() {
    if (this.#revoked || !await this.#source()) throw new DisclosureDenied();
    const fresh=await this.#session.reauthorize();
    if (this.#revoked) throw new DisclosureDenied();
    return { snapshot:fresh, payload:projectFixture(fresh,{requireDesignProposal:this.#requireProposal}) };
  }
  async prepare() {
    const {snapshot,payload}=await this.#current();
    const bundle=immutable({ version:1, export_id:randomUUID(), plan_revision:snapshot.plan_revision,
      recipient:this.#recipient, purpose:'dashboard_design', policy_version:1,
      expires_at:this.#clock()+120_000, data_version:digest(payload), payload });
    this.#bundles.set(bundle.export_id,bundle);
    return bundle;
  }
  async authorize(bundle, phase) {
    requireThat(['send','use'].includes(phase));
    const known=this.#bundles.get(bundle.export_id);
    if (!known || digest(known)!==digest(bundle) || bundle.expires_at<=this.#clock()) throw new DisclosureDenied();
    const {snapshot,payload}=await this.#current();
    if (snapshot.plan_revision!==bundle.plan_revision || digest(payload)!==bundle.data_version
      || bundle.expires_at<=this.#clock() || this.#revoked) throw new DisclosureDenied();
    // Audit must succeed before any send or use. No model prose/errors in this log.
    await this.#audit({event:phase, export_id:bundle.export_id, recipient:bundle.recipient,
      purpose:bundle.purpose, policy_version:bundle.policy_version, digest:bundle.data_version, at:this.#clock()});
    if (this.#revoked || bundle.expires_at<=this.#clock()) throw new DisclosureDenied();
  }
}
