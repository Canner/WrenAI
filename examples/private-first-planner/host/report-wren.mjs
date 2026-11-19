import { randomUUID } from 'node:crypto';
import { digest, requireThat } from '../contracts.mjs';
import { requestWorker, readWorkerEvidence } from '../harnesses/worker.mjs';

// Uses the host's existing connectWren() port. A semantic plan is rendered as a
// bounded ask_data request; Wren owns SQL generation/execution under its policy.
// There is no arbitrary run_sql entry and no worker-owned MCP server.
export class WrenReportExecutor {
  #port; #session; #pending; #busy = false; #closed = false;
  constructor(port) { this.#port = port; }
  async execute({ plan, source, signal, timeoutMs = 180000, answer, pending }) {
    requireThat(!this.#busy && !this.#closed); this.#busy = true;
    const deadline = Date.now() + timeoutMs;
    const call = async (name, args) => { signal?.throwIfAborted(); requireThat(Date.now() < deadline);
      const result = await this.#port.call(name, args, { timeoutMs: deadline - Date.now() }); signal?.throwIfAborted(); return result; };
    try {
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
        req.question = `Execute this admitted semantic aggregate plan using the confirmed project definitions.\n${JSON.stringify(plan)}\n`
          + 'Return one table: period (UTC bucket-start date YYYY-MM-DD), then exactly the requested dimension and measure IDs as columns. '
          + 'Filter source timestamps before bucketing, including partial weeks. Apply all requested filters and project rules. '
          + 'Return all groups with no hidden top-N or truncation; do not add raw records or extra columns. '
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
