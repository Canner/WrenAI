import { randomUUID } from 'node:crypto';
import { digest, requireThat } from '../contracts.mjs';
import { requestWorker, readWorkerEvidence } from '../harnesses/worker.mjs';

// Uses the host's existing connectWren() port. A semantic plan is rendered as a
// bounded ask_data request; Wren owns SQL generation/execution under its policy.
// There is no arbitrary run_sql entry and no worker-owned MCP server.
export class WrenReportExecutor {
  #port; #isolateReports; #session; #pending; #busy = false; #closed = false;
  constructor(port, { isolateReports = false } = {}) { this.#port = port; this.#isolateReports = isolateReports; }
  async execute({ plan, source, signal, timeoutMs = 180000, answer, pending }) {
    requireThat(!this.#busy && !this.#closed); this.#busy = true;
    const deadline = Date.now() + timeoutMs;
    const call = async (name, args) => { signal?.throwIfAborted(); requireThat(Date.now() < deadline);
      const result = await this.#port.call(name, args, { timeoutMs: deadline - Date.now() }); signal?.throwIfAborted(); return result; };
    try {
      // A partition is an independent query, not a follow-up to the last table.
      // Keep a pending clarification in its original session and revision.
      if (this.#isolateReports && answer === undefined && this.#session && !this.#pending) {
        const closed = await call('close_session', { session_id: this.#session.session_id });
        requireThat(closed.status === 'closed'); this.#session = null;
      }
      if (!this.#session) {
        this.#session = await call('open_session', {});
        requireThat(typeof this.#session.session_id === 'string' && this.#session.revision === 0);
        if (this.#closed) { await this.close(); throw Error('report_executor_closed'); }
      }
      const req = { session_id: this.#session.session_id, request_id: randomUUID(), expected_revision: this.#session.revision };
      let operation = 'ask_data';
      if (answer !== undefined) {
        requireThat(this.#pending && pending?.continuation_ref === this.#pending.continuation_ref && digest(plan) === this.#pending.plan_digest);
        operation = 'continue_task'; req.continuation_ref = this.#pending.continuation_ref; req.answer = answer;
      } else {
        requireThat(!this.#pending && source.id === plan.source_id && source.revision === plan.source_revision);
        req.capability = source.capability;
        req.question = `Execute one admitted aggregate report. Selected ${source.kind}: ${source.id}.\n`
          + `Measures in output order: ${plan.query.measures.join(', ')}. Dimensions in output order: ${plan.query.dimensions.join(', ')}.\n`
          + `Period: ${plan.query.period.lower} inclusive to ${plan.query.period.upper} exclusive, UTC ${plan.query.period.grain}.\n`
          + `Private source binding: ${JSON.stringify(source.metadata)}\n`
          + `Admitted plan: ${JSON.stringify(plan)}\n`
          + 'Select period first (UTC bucket start), then requested dimensions and measures in their listed order. Use those IDs as SQL aliases. '
          + 'Wren intentionally returns host keys c1, c2, etc. and derived labels instead of SQL aliases; do not retry to rename those response keys. Midnight ISO date/timestamp values are valid. Return only the successful evidence token; the host maps and verifies the result. '
          + 'Filter source timestamps before bucketing, including partial weeks. Apply all requested filters and project rules. '
          + 'Return all groups with no hidden top-N or truncation; do not add raw records or extra columns. '
          + 'For a selected cube, read that exact cube ID and its base view/model using read_context even if it is absent from the first context-index page. Do not substitute another cube. '
          + 'Do not treat a cube name as a SQL table. Reuse its confirmed definitions or supported cube query surface. '
          + 'If definitions are ambiguous, request clarification. Do not create or persist a cube.';
      }
      const response = await requestWorker({ call, operation, request: req });
      if (!['completed', 'needs_clarification'].includes(response.status)) throw Error('report_query_failed');
      requireThat(response.revision === this.#session.revision + 1); this.#session.revision = response.revision;
      if (response.status === 'needs_clarification') {
        requireThat(typeof response.continuation_ref === 'string' && typeof response.question === 'string');
        this.#pending = { continuation_ref: response.continuation_ref, plan_digest: digest(plan) };
        return { ...this.#pending, status: 'needs_clarification', question: response.question };
      }
      const checked = await readWorkerEvidence({ call, sessionId: this.#session.session_id, response, grain: 'report' });
      this.#pending = null;
      return { status: 'completed', plan_digest: digest(plan), result: response.result, result_ref: response.result_ref,
        evidence_ref: response.evidence_ref, evidence: checked.evidence };
    } finally { this.#busy = false; }
  }
  continueExecution(input) { return this.execute(input); }
  async close() {
    this.#closed = true;
    if (this.#session) { const r = await this.#port.call('close_session', { session_id: this.#session.session_id }, { timeoutMs: 10000 }); requireThat(r.status === 'closed'); this.#session = null; }
  }
}
