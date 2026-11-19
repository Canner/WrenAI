import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { immutable, requireThat } from '../contracts.mjs';
import { validatePayload } from './contracts.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Operator-produced evidence is a trust input. This adapter does not manufacture
// semantic verification or run a query; every use rechecks its exact source bytes.
export async function openReplay({ payload: payloadPath, grant: grantPath }) {
  requireThat(isAbsolute(payloadPath) && isAbsolute(grantPath));
  const grantBytes = await readFile(grantPath), grant = JSON.parse(grantBytes);
  requireThat(grant.version === 'verified-replay/1' && /^[a-f0-9]{64}$/.test(grant.payload_sha256)
    && grant.verified_checks?.gross === true && grant.verified_checks?.refunds === true
    && Array.isArray(grant.sources) && grant.sources.length > 0 && grant.sources.length <= 16
    && grant.sources.every(s => isAbsolute(s.path) && /^[a-f0-9]{64}$/.test(s.sha256)));
  const read = async () => {
    requireThat(sha(await readFile(grantPath)) === sha(grantBytes));
    const bytes = await readFile(payloadPath); requireThat(sha(bytes) === grant.payload_sha256);
    for (const source of grant.sources) requireThat(sha(await readFile(source.path)) === source.sha256);
    return validatePayload(JSON.parse(bytes));
  };
  const payload = await read();
  return { payload, read, evidence: immutable({ version: 'verified-replay/1', payload_sha256: grant.payload_sha256,
    source_hashes: grant.sources.map(s => s.sha256), verified_checks: grant.verified_checks,
    cells: payload.rows.length, queried_database: false }) };
}
