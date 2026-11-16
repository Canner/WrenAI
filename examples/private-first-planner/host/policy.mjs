import { assessData, dataAssessment } from '../harnesses/data-validation.mjs';
import { fixturePayload, projectFixture } from '../p2/broker.mjs';
import { immutable, requireThat } from '../contracts.mjs';

// Domain adapters are explicit trusted deployment inputs. No default inference
// that a Wren result (or a model's "aggregate" label) is safe for export.
export function aggregatePolicy({ id, version, briefs, verify, project, assessData: assess = assessData }) {
  requireThat(typeof id === 'string' && typeof version === 'string' && typeof verify === 'function'
    && typeof project === 'function' && typeof assess === 'function' && briefs && Object.values(briefs).every(x => typeof x === 'string' && x.length <= 2048));
  return Object.freeze({ id, version, briefs: immutable(briefs), assessData: assess, async project(snapshot) {
    requireThat(await verify(snapshot) === true);
    const payload = await project(snapshot);
    // Projection must independently discard labels, SQL, metadata and refs.
    requireThat(payload && Array.isArray(payload.datasets) && payload.datasets.length <= 8);
    return immutable(payload);
  } });
}
export function fixturePolicy(verifySource) {
  return aggregatePolicy({ id: 'synthetic-revenue', version: '1',
    briefs: { default: 'Design a clear executive revenue dashboard using only these approved synthetic aggregates.' },
    verify: verifySource, assessData: async input => {
      if (await verifySource() !== true) {
        const base = assessData(input);
        return dataAssessment(base.blockers, [...base.warnings, 'fixture_scope_unverified']);
      }
      return assessFixtureData(input);
    }, project: snapshot => projectFixture(snapshot, { requireDesignProposal: false }) });
}

// Values are known only for this explicitly authorized synthetic fixture. General
// deployments use evidence checks or supply their own trusted domain validator.
export function assessFixtureData(input) {
  const base = assessData(input);
  const period = input.period;
  if (base.status === 'rejected' || period?.lower !== fixturePayload.period.lower
      || period?.upper !== fixturePayload.period.upper || period?.timezone !== 'UTC') return base;
  const constraints = input.constraints;
  if (!/revenue|營收/i.test(input.group?.metric ?? '') || constraints?.filters?.length !== 0
      || !Array.isArray(constraints.requested_statuses)
      || (constraints.requested_statuses.length && [...constraints.requested_statuses].sort().join(',') !== 'paid,shipped'))
    return dataAssessment(base.blockers, [...base.warnings, 'fixture_scope_unverified']);
  const keys = input.result.columns.map(c => c.key), expected = fixturePayload.datasets.find(d => d.grain === input.grain);
  const rows = input.result.rows.map(row => input.grain === 'scalar' ? [row[keys[0]]]
    : [String(row[keys.find(k => typeof row[k] === 'string')]).slice(0, 10), row[keys.find(k => typeof row[k] === 'number')]]);
  const want = expected.rows.map(row => expected.columns.map(key => row[key]));
  return dataAssessment([...base.blockers, ...(JSON.stringify(rows) === JSON.stringify(want) ? [] : ['value_mismatch'])], base.warnings);
}
