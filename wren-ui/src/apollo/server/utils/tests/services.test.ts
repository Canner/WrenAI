import { addAutoIncrementId } from '../services';

describe('addAutoIncrementId', () => {
  it('should add auto-incrementing ids to an array of objects', () => {
    const query = [{ name: 'Item 1' }, { name: 'Item 2' }, { name: 'Item 3' }];

    const result = addAutoIncrementId(query);

    expect(result).toEqual([
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
      { id: 3, name: 'Item 3' },
    ]);
  });

  it('should add auto-incrementing ids to nested objects', () => {
    const query = {
      name: 'Parent',
      child: {
        name: 'Child',
        grandchild: {
          name: 'Grandchild',
        },
      },
    };

    const result = addAutoIncrementId(query);

    expect(result).toEqual({
      id: 1,
      name: 'Parent',
      child: {
        id: 2,
        name: 'Child',
        grandchild: {
          id: 3,
          name: 'Grandchild',
        },
      },
    });
  });

  it('should not modify the original query', () => {
    const query = { name: 'Item' };

    addAutoIncrementId(query);

    expect(query).toEqual({ name: 'Item' });
  });

  it('should get expected result with query analysis result', () => {
    const analysis = [
      {
        filter: {
          left: {
            node: '(custkey = 1)',
            type: 'EXPR',
          },
          right: {
            node: "(name = 'tom')",
            type: 'EXPR',
          },
          type: 'AND',
        },
        groupByKeys: [['c.name']],
        relation: {
          criteria: 'ON (c.custkey = o.custkey)',
          left: {
            alias: 'c',
            tableName: 'Customer',
            type: 'TABLE',
          },
          right: {
            alias: 'o',
            tableName: 'Orders',
            type: 'TABLE',
          },
          type: 'INNER_JOIN',
        },
        selectItems: [
          {
            alias: null,
            expression: 'c.name',
            properties: {
              includeFunctionCall: 'false',
              includeMathematicalOperation: 'false',
            },
          },
          {
            alias: null,
            expression: 'count(*)',
            properties: {
              includeFunctionCall: 'true',
              includeMathematicalOperation: 'false',
            },
          },
        ],
        sortings: [
          {
            expression: 'c.name',
            ordering: 'DESCENDING',
          },
        ],
      },
    ];
    const expected = [
      {
        id: 1,
        filter: {
          id: 2,
          left: {
            id: 3,
            node: '(custkey = 1)',
            type: 'EXPR',
          },
          right: {
            id: 4,
            node: "(name = 'tom')",
            type: 'EXPR',
          },
          type: 'AND',
        },
        groupByKeys: [['c.name']],
        relation: {
          id: 5,
          criteria: 'ON (c.custkey = o.custkey)',
          left: {
            id: 6,
            alias: 'c',
            tableName: 'Customer',
            type: 'TABLE',
          },
          right: {
            id: 7,
            alias: 'o',
            tableName: 'Orders',
            type: 'TABLE',
          },
          type: 'INNER_JOIN',
        },
        selectItems: [
          {
            id: 8,
            alias: null,
            expression: 'c.name',
            properties: {
              includeFunctionCall: 'false',
              includeMathematicalOperation: 'false',
            },
          },
          {
            id: 9,
            alias: null,
            expression: 'count(*)',
            properties: {
              includeFunctionCall: 'true',
              includeMathematicalOperation: 'false',
            },
          },
        ],
        sortings: [
          {
            id: 10,
            expression: 'c.name',
            ordering: 'DESCENDING',
          },
        ],
      },
    ];

    const result = addAutoIncrementId(analysis);
    expect(result).toEqual(expected);
  });
});
