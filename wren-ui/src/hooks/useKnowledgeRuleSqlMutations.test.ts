import {
  buildInstructionCreateVariables,
  buildInstructionDeleteVariables,
  buildInstructionUpdateVariables,
  buildSqlPairCreateVariables,
  buildSqlPairDeleteVariables,
  buildSqlPairUpdateVariables,
} from './useKnowledgeRuleSqlMutations';

describe('useKnowledgeRuleSqlMutations helpers', () => {
  it('builds instruction mutation variables', () => {
    const instructionInput = {
      instruction: '规则A',
      isDefault: true,
      questions: [],
    };
    const updateInstructionInput = {
      instruction: '规则B',
      isDefault: false,
      questions: ['问题B'],
    };

    expect(buildInstructionCreateVariables(instructionInput)).toEqual({
      variables: { data: instructionInput },
    });

    expect(buildInstructionUpdateVariables(1, updateInstructionInput)).toEqual({
      variables: {
        where: { id: 1 },
        data: updateInstructionInput,
      },
    });

    expect(buildInstructionDeleteVariables(1)).toEqual({
      variables: {
        where: { id: 1 },
      },
    });
  });

  it('builds sql pair mutation variables', () => {
    expect(
      buildSqlPairCreateVariables({ question: 'Q', sql: 'SELECT 1' }),
    ).toEqual({
      variables: { data: { question: 'Q', sql: 'SELECT 1' } },
    });

    expect(
      buildSqlPairUpdateVariables(2, {
        question: 'Q2',
        sql: 'SELECT 2',
      }),
    ).toEqual({
      variables: {
        where: { id: 2 },
        data: { question: 'Q2', sql: 'SELECT 2' },
      },
    });

    expect(buildSqlPairDeleteVariables(2)).toEqual({
      variables: {
        where: { id: 2 },
      },
    });
  });
});
