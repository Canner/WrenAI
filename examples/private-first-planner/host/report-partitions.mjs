import { digest, immutable, requireThat } from '../contracts.mjs';
import { request } from '../analysis/contracts.mjs';

// Optional deployment-owned label binding for dimension columns only. This is
// projection, not semantic verification: callers must still verify every value,
// metric, period and group against their independent admission policy.
export function reportColumnKeys(columns, query, dimensionLabels) {
  const count = 1 + query.dimensions.length + query.measures.length;
  requireThat(Array.isArray(columns) && columns.length === count);
  const keys = columns.map(c => c.key);
  requireThat(keys.every(k => typeof k === 'string' && k.length > 0) && new Set(keys).size === count);
  const dimensions = columns.slice(1, 1 + query.dimensions.length);
  const selected = query.dimensions.map(id => {
    const labels = dimensionLabels[id];
    requireThat(Array.isArray(labels) && labels.length > 0 && labels.every(l => typeof l === 'string' && l.length > 0));
    const matches = dimensions.filter(c => labels.includes(c.label));
    requireThat(matches.length === 1);
    return matches[0].key;
  });
  requireThat(new Set(selected).size === query.dimensions.length);
  return [keys[0], ...selected, ...keys.slice(1 + query.dimensions.length)];
}

// Deployment chooses a bounded period partition and verifies each raw Wren table
// before mapping host-labelled columns or decimal text to report fields. Neither
// the model nor this concatenator can attest semantics/completeness by itself.
export class PartitionedReportExecutor {
  #executor; #policy; #run; #busy = false;
  constructor(executor, policy) {
    requireThat(typeof policy?.periods === 'function' && typeof policy?.project === 'function');
    this.#executor = executor; this.#policy = policy;
  }
  async execute(input) {
    requireThat(!this.#busy && !this.#run); this.#busy = true;
    try {
      const periods = await this.#policy.periods(immutable({ plan: input.plan, source: input.source }));
      requireThat(Array.isArray(periods) && periods.length > 0 && periods.length <= 24);
      const parent = input.plan.query, plans = periods.map(period => immutable({ ...input.plan, query: request({ ...parent, period }) }));
      let lower = parent.period.lower;
      for (const p of plans) {
        requireThat(p.query.period.lower === lower && p.query.period.grain === parent.period.grain);
        if (parent.period.grain === 'week' && lower !== parent.period.lower) requireThat(new Date(lower).getUTCDay() === 1);
        lower = p.query.period.upper;
      }
      requireThat(lower === parent.period.upper);
      this.#run = { parent: digest(input.plan), plans, index: 0, parts: [], pending: null };
      return await this.#advance(input);
    } catch (error) { this.#run = null; throw error; }
    finally { this.#busy = false; }
  }
  async continueExecution(input) {
    requireThat(!this.#busy && this.#run?.pending && digest(input.plan) === this.#run.parent
      && input.pending?.continuation_ref === this.#run.pending.continuation_ref);
    this.#busy = true;
    try { return await this.#advance(input, true); }
    catch (error) { this.#run = null; throw error; }
    finally { this.#busy = false; }
  }
  async #advance(input, continuing = false) {
    const run = this.#run, deadline = Date.now() + (input.timeoutMs ?? 180000);
    while (run.index < run.plans.length) {
      input.signal?.throwIfAborted(); const timeoutMs = deadline - Date.now(); requireThat(timeoutMs > 0);
      const plan = run.plans[run.index], args = { ...input, plan, timeoutMs };
      const execution = continuing ? await this.#executor.continueExecution({ ...args, pending: run.pending }) : await this.#executor.execute(args);
      continuing = false; input.signal?.throwIfAborted();
      if (execution.status === 'needs_clarification') { run.pending = execution; return execution; }
      requireThat(execution.status === 'completed' && execution.plan_digest === digest(plan));
      const admitted = await this.#policy.project(immutable({ plan, source: input.source, execution }));
      input.signal?.throwIfAborted();
      requireThat(admitted?.verified === true && admitted.complete === true && admitted.query_digest === digest(plan.query)
        && admitted.source_revision === input.source.revision && admitted.raw_result_digest === digest(execution.result)
        && admitted.result?.kind === 'table' && Array.isArray(admitted.result.rows) && Array.isArray(admitted.result.columns));
      run.parts.push({ plan, execution, result: admitted.result }); run.index++; run.pending = null;
    }
    const columns = run.parts[0].result.columns, rows = [], seen = new Set();
    for (const part of run.parts) {
      requireThat(digest(part.result.columns) === digest(columns));
      for (const row of part.result.rows) {
        const key = digest(['period', ...input.plan.query.dimensions].map(k => row[k]));
        requireThat(!seen.has(key)); seen.add(key); rows.push(row);
      }
    }
    requireThat(rows.length <= 5000);
    const evidence = { version: 'partitioned-report-evidence/1', parts: run.parts }, identity = digest(evidence);
    this.#run = null;
    return immutable({ status: 'completed', plan_digest: run.parent, result: { kind: 'table', columns, rows },
      result_ref: `partitioned:${identity}`, evidence_ref: `partitioned:${identity}`, evidence });
  }
  async close() { this.#run = null; await this.#executor.close(); }
}
