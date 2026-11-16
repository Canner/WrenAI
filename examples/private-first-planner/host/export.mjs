import { randomUUID } from 'node:crypto';
import { digest, immutable, requireThat, DisclosureDenied } from '../contracts.mjs';

// A policy is trusted deployment code, NEVER model output. Its project method
// must verify domain semantics/evidence and return only disclosable aggregates.
// This broker owns the user grant, freshness and audit, not semantic inference.
export class ExportBroker {
  #policy; #current; #audit; #clock; #epoch; #bundle; #approved = false; #revoked = false;
  constructor({ policy, current, audit, epoch, now = Date.now }) {
    requireThat(typeof policy.project === 'function' && typeof policy.id === 'string'
      && typeof policy.version === 'string' && typeof current === 'function');
    this.#policy = policy; this.#current = current; this.#audit = audit; this.#epoch = epoch; this.#clock = now;
  }
  async propose({ recipient, brief_id }) {
    requireThat(!this.#bundle && typeof recipient === 'string' && Object.hasOwn(this.#policy.briefs, brief_id));
    const payload = await this.#policy.project(await this.#current());
    requireThat(payload && typeof payload === 'object' && Buffer.byteLength(JSON.stringify(payload)) <= 64 * 1024);
    this.#bundle = immutable({ version: 1, export_id: randomUUID(), recipient, purpose: 'dashboard_design',
      policy_id: this.#policy.id, policy_version: this.#policy.version, epoch: this.#epoch,
      expires_at: this.#clock() + 120_000, data_version: digest(payload), payload,
      brief_id, design_brief: this.#policy.briefs[brief_id], max_repairs: 1 });
    return this.#bundle;
  }
  approve(export_id, request_digest) {
    requireThat(this.#bundle?.export_id === export_id && digest(this.#bundle) === request_digest && !this.#revoked);
    this.#approved = true;
  }
  revoke() { this.#revoked = true; this.#approved = false; }
  async prepare() { await this.authorize(this.#bundle, 'use'); return this.#bundle; }
  #check(bundle) {
    if (!bundle || !this.#approved || this.#revoked
      || digest(bundle) !== digest(this.#bundle) || this.#clock() >= bundle.expires_at
      || this.#policy.id !== bundle.policy_id || this.#policy.version !== bundle.policy_version
      || this.#policy.briefs[bundle.brief_id] !== bundle.design_brief) throw new DisclosureDenied();
  }
  async authorize(bundle, phase) {
    if (!['send', 'use'].includes(phase)) throw new DisclosureDenied();
    this.#check(bundle);
    const payload = await this.#policy.project(await this.#current());
    this.#check(bundle);
    if (digest(payload) !== bundle.data_version) throw new DisclosureDenied();
    await this.#audit({ phase, export_id: bundle.export_id, request_digest: digest(bundle) });
    this.#check(bundle);
  }
}
