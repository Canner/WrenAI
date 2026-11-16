import { immutable,digest,requireThat } from '../contracts.mjs';
// A paired benchmark keeps one completed data session open while three design
// arms independently reauthorize the same immutable results. No new mutation.
// This separate evidence budget is explicit; P1 query/model limits are unchanged.
export class EvidenceLease {
  #port;#snapshot;#session;#deadline;calls=0;
  constructor(port,snapshot,deadline) {
    requireThat(snapshot.state==='completed');
    this.#port=port;this.#snapshot=immutable(snapshot);this.#deadline=deadline;
    this.#session=snapshot.trace.find(t=>t.name==='open_session')?.response?.session_id;
    requireThat(typeof this.#session==='string');
  }
  async reauthorize() {
    for(const item of this.#snapshot.results) {
      const left=this.#deadline-Date.now();requireThat(left>0&&this.calls++<32);
      const fresh=await this.#port.call('get_evidence',{request:{session_id:this.#session,evidence_ref:item.evidence_ref}},{timeoutMs:Math.min(10000,left)});
      requireThat(digest(fresh.result)===digest(item.result)&&digest(fresh.evidence)===digest(item.evidence));
    }
    return this.#snapshot;
  }
}
