import { constructCteSql } from '../askingService';

describe('AskingService', () => {
  describe('utility: constructCteSql', () => {
    test('oneline sql', () => {
      const sql = 'SELECT * FROM test';
      const steps = [{ sql, summary: 'test', cteName: '' }];
      const result = constructCteSql(steps);
      expect(result).toBe(`-- test\nSELECT * FROM test`);
    });

    test('2 steps of sql', () => {
      const steps = [
        {
          sql: 'SELECT * FROM test',
          summary: 'test1 summary',
          cteName: 'test1',
        },
        { sql: 'SELECT * FROM test2', summary: 'test2', cteName: '' },
      ];
      const result = constructCteSql(steps);
      expect(result).toBe(
        `WITH test1 AS\n-- test1 summary\n(SELECT * FROM test)\n-- test2\nSELECT * FROM test2`,
      );
    });

    test('3 steps of sql', () => {
      const steps = [
        {
          sql: 'SELECT * FROM test',
          summary: 'test1 summary',
          cteName: 'test1',
        },
        {
          sql: 'SELECT * FROM test2',
          summary: 'test2 summary',
          cteName: 'test2',
        },
        { sql: 'SELECT * FROM test3', summary: 'test3', cteName: '' },
      ];
      const result = constructCteSql(steps);
      expect(result).toBe(
        `WITH test1 AS\n-- test1 summary\n(SELECT * FROM test),` +
          `test2 AS\n-- test2 summary\n(SELECT * FROM test2)\n-- test3\nSELECT * FROM test3`,
      );
    });

    test('2 steps of sql with stepIndex=0', () => {
      const steps = [
        {
          sql: 'SELECT * FROM test',
          summary: 'test1 summary',
          cteName: 'test1',
        },
        { sql: 'SELECT * FROM test2', summary: 'test2', cteName: '' },
      ];
      const result = constructCteSql(steps, 0);
      expect(result).toBe(`-- test1 summary\nSELECT * FROM test`);
    });

    test('2 steps of sql with stepIndex=1', () => {
      const steps = [
        {
          sql: 'SELECT * FROM test',
          summary: 'test1 summary',
          cteName: 'test1',
        },
        { sql: 'SELECT * FROM test2', summary: 'test2', cteName: '' },
      ];
      const result = constructCteSql(steps, 1);
      expect(result).toBe(
        `WITH test1 AS\n-- test1 summary\n(SELECT * FROM test)\n-- test2\nSELECT * FROM test2`,
      );
    });

    test('3 steps of sql with stepIndex=1', () => {
      const steps = [
        {
          sql: 'SELECT * FROM test',
          summary: 'test1 summary',
          cteName: 'test1',
        },
        {
          sql: 'SELECT * FROM test2',
          summary: 'test2 summary',
          cteName: 'test2',
        },
        { sql: 'SELECT * FROM test3', summary: 'test3', cteName: '' },
      ];
      const result = constructCteSql(steps, 1);
      expect(result).toBe(
        `WITH test1 AS\n-- test1 summary\n(SELECT * FROM test)` +
          `\n-- test2 summary\nSELECT * FROM test2`,
      );
    });
  });
});
