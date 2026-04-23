import { buildSemanticsDescriptionSavePayload } from './recommendSemanticsSupport';

describe('recommendSemanticsSupport', () => {
  it('maps generated semantics back to model metadata payloads', () => {
    const payload = buildSemanticsDescriptionSavePayload({
      generatedModels: [
        {
          name: 'employees',
          description: 'Employee records',
          columns: [
            { name: 'id', description: 'Employee id' },
            { name: 'name', description: 'Employee name' },
          ],
        },
      ],
      models: [
        {
          id: 10,
          displayName: 'Employees',
          referenceName: 'employees',
          sourceTableName: 'employees',
          cached: false,
          fields: [
            {
              id: 100,
              displayName: 'ID',
              referenceName: 'id',
              sourceColumnName: 'id',
              isCalculated: false,
              notNull: true,
            },
            {
              id: 101,
              displayName: 'Name',
              referenceName: 'name',
              sourceColumnName: 'name',
              isCalculated: false,
              notNull: false,
            },
          ],
          calculatedFields: [],
        },
      ] as any,
    });

    expect(payload).toEqual([
      {
        modelId: 10,
        data: {
          description: 'Employee records',
          columns: [
            { id: 100, description: 'Employee id' },
            { id: 101, description: 'Employee name' },
          ],
        },
      },
    ]);
  });
});
