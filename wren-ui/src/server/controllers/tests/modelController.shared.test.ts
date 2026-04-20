import {
  findConnectionTableByNameSupport,
  resolveCompactTableNameCandidates,
  validateTableExistSupport,
} from '../modelControllerShared';

describe('modelControllerShared table identity helpers', () => {
  const connectionTables = [
    {
      name: 'dwd_order_task',
      columns: [{ name: 'id', type: 'string' }],
      properties: {
        catalog: '',
        schema: 'report_demo',
        table: 'dwd_order_task',
      },
    },
  ] as any;

  it('builds scoped name candidates from compact table properties', () => {
    expect(resolveCompactTableNameCandidates(connectionTables[0])).toEqual(
      expect.arrayContaining(['dwd_order_task', 'report_demo.dwd_order_task']),
    );
  });

  it('matches schema-qualified table names against connection metadata', () => {
    expect(
      findConnectionTableByNameSupport(
        'report_demo.dwd_order_task',
        connectionTables,
      ),
    ).toBe(connectionTables[0]);
  });

  it('accepts qualified names during table existence validation', () => {
    expect(() =>
      validateTableExistSupport('report_demo.dwd_order_task', connectionTables),
    ).not.toThrow();
  });
});
