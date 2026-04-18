import {
  buildInstructionCreateArgs,
  buildInstructionDeleteArgs,
  buildInstructionUpdateArgs,
  buildSqlPairCreateArgs,
  buildSqlPairDeleteArgs,
  buildSqlPairUpdateArgs,
  hasKnowledgeRuleSqlScope,
} from './useKnowledgeRuleSqlActions';

describe('useKnowledgeRuleSqlActions helpers', () => {
  it('builds instruction action args', () => {
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

    expect(buildInstructionCreateArgs(instructionInput)).toEqual({
      data: instructionInput,
    });

    expect(buildInstructionUpdateArgs(1, updateInstructionInput)).toEqual({
      id: 1,
      data: updateInstructionInput,
    });

    expect(buildInstructionDeleteArgs(1)).toEqual({
      id: 1,
    });
  });

  it('builds sql pair action args', () => {
    expect(buildSqlPairCreateArgs({ question: 'Q', sql: 'SELECT 1' })).toEqual({
      data: { question: 'Q', sql: 'SELECT 1' },
    });

    expect(
      buildSqlPairUpdateArgs(2, {
        question: 'Q2',
        sql: 'SELECT 2',
      }),
    ).toEqual({
      id: 2,
      data: { question: 'Q2', sql: 'SELECT 2' },
    });

    expect(buildSqlPairDeleteArgs(2)).toEqual({
      id: 2,
    });
  });

  it('requires knowledge base scope before loading rule/sql lists', () => {
    expect(hasKnowledgeRuleSqlScope({ workspaceId: 'ws-1' })).toBe(false);
    expect(
      hasKnowledgeRuleSqlScope({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
    ).toBe(true);
    expect(hasKnowledgeRuleSqlScope({ runtimeScopeId: 'scope-1' })).toBe(false);
  });
});
