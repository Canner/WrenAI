// Shared contract assertions, immutable values and canonical identities.
import { createHash } from 'node:crypto';

export class ContractError extends Error {
  constructor() { super('invalid_contract'); }
}
export class DisclosureDenied extends Error {
  constructor() { super('disclosure_denied'); }
}
export function requireThat(condition) {
  if (!condition) throw new ContractError();
}
export function immutable(value) {
  const copy = structuredClone(value);
  const freeze = (v) => {
    if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); }
    return v;
  };
  return freeze(copy);
}
// Canonical object ordering makes the digest independent of JSON key order.
export function digest(value) {
  const canonical = (v) => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
