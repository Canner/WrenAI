import test from 'node:test';
import assert from 'node:assert/strict';
import { validateResultGrain } from '../retrieval.mjs';

test('weekly gate rejects observed time-of-day splits, duplicate weeks and extra columns', () => {
  const result = { kind: 'table', columns: [{key:'d'}, {key:'v'}], rows: [{d:'2025-12-29T00:00:00',v:50},{d:'2026-01-05T00:00:00',v:220}] };
  assert.equal(validateResultGrain(result, 'week'), true);
  for (const rows of [[{d:'2026-01-05T23:59:59',v:220}], [{d:'2026-01-06',v:220}], [{d:'2026-01-05',v:100},{d:'2026-01-05',v:120}]])
    assert.equal(validateResultGrain({...result,rows}, 'week'), false);
  assert.equal(validateResultGrain({...result,columns:[...result.columns,{key:'extra'}]}, 'week'), false);
  assert.equal(validateResultGrain(result, 'scalar'), false);
});
