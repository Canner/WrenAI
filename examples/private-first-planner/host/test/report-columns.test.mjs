import test from 'node:test';
import assert from 'node:assert/strict';
import { reportColumnKeys } from '../report-partitions.mjs';

const query = { dimensions: ['region', 'category'], measures: ['total'] };
const labels = { region: ['area'], category: ['category'] };
const columns = [{ key: 'c1', label: 'period' }, { key: 'c2', label: 'category' },
  { key: 'c3', label: 'area' }, { key: 'c4', label: 'sum_amount' }];

test('trusted dimension bindings tolerate order changes without changing raw evidence', () => {
  const original = structuredClone(columns);
  assert.deepEqual(reportColumnKeys(columns, query, labels), ['c1', 'c3', 'c2', 'c4']);
  assert.deepEqual(columns, original);
});

test('ambiguous, missing or non-dimension label matches fail closed', () => {
  for (const changed of [
    columns.map((c,i) => i === 1 ? { ...c, label: 'area' } : c),
    columns.map((c,i) => i === 2 ? { ...c, label: 'unknown' } : c),
    [columns[0], columns[1], columns[3], columns[2]],
    columns.map((c,i) => i === 2 ? { ...c, key: 'c2' } : c),
    [...columns, { key: 'c5', label: 'extra' }],
  ]) assert.throws(() => reportColumnKeys(changed, query, labels));
  assert.throws(() => reportColumnKeys(columns, query, { region: ['area'], category: ['area'] }));
  assert.throws(() => reportColumnKeys(columns, query, {}));
});
