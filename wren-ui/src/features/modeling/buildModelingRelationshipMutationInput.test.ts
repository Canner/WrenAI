import buildModelingRelationshipMutationInput from './buildModelingRelationshipMutationInput';

const encode = (id: string, referenceName: string) =>
  `id:${id}☺referenceName:${referenceName}`;

describe('buildModelingRelationshipMutationInput', () => {
  it('builds create payload from relation form identifiers', () => {
    const result = buildModelingRelationshipMutationInput({
      fromField: {
        model: encode('101', 'orders'),
        field: encode('201', 'customer_id'),
      },
      toField: {
        model: encode('102', 'customers'),
        field: encode('202', 'id'),
      },
      type: 'MANY_TO_ONE',
    });

    expect(result).toEqual({
      relationId: null,
      payload: {
        fromModelId: 101,
        fromColumnId: 201,
        toModelId: 102,
        toColumnId: 202,
        type: 'MANY_TO_ONE',
      },
    });
  });

  it('builds update payload when relation id is present', () => {
    const result = buildModelingRelationshipMutationInput({
      relationId: 88,
      fromField: {
        model: encode('101', 'orders'),
        field: encode('201', 'customer_id'),
      },
      toField: {
        model: encode('102', 'customers'),
        field: encode('202', 'id'),
      },
      type: 'ONE_TO_ONE',
    });

    expect(result).toEqual({
      relationId: 88,
      payload: {
        type: 'ONE_TO_ONE',
      },
    });
  });
});
