import type { Instruction } from '@/types/api';
import {
  parseInstructionDraft,
  shouldUseRuleSqlListCache,
} from './useKnowledgeRuleSqlManager';

const buildInstruction = (
  overrides: Partial<Instruction> = {},
): Instruction => ({
  __typename: 'Instruction',
  id: 1,
  instruction: '',
  isDefault: false,
  questions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('useKnowledgeRuleSqlManager helpers', () => {
  it('parses structured instruction blocks', () => {
    const instruction = buildInstruction({
      isDefault: true,
      instruction: '【规则描述】输出规范\n【规则内容】先输出结论，再解释原因',
    });

    expect(parseInstructionDraft(instruction)).toEqual({
      summary: '输出规范',
      scope: 'all',
      content: '先输出结论，再解释原因',
    });
  });

  it('falls back to question and raw content for legacy instructions', () => {
    const instruction = buildInstruction({
      instruction: '按月统计销售额',
      questions: ['月度销售趋势'],
    });

    expect(parseInstructionDraft(instruction)).toEqual({
      summary: '月度销售趋势',
      scope: 'matched',
      content: '按月统计销售额',
    });
  });

  it('returns empty draft when instruction is empty', () => {
    const instruction = buildInstruction({
      instruction: '   ',
      isDefault: false,
    });

    expect(parseInstructionDraft(instruction)).toEqual({
      summary: '',
      scope: 'matched',
      content: '',
    });
  });

  it('uses cached rule/sql list only when cache is fresh and no force refresh', () => {
    expect(
      shouldUseRuleSqlListCache({
        forceRefresh: false,
        cachedCount: 3,
        lastLoadedAt: 1_000,
        now: 5_000,
        ttlMs: 10_000,
      }),
    ).toBe(true);

    expect(
      shouldUseRuleSqlListCache({
        forceRefresh: true,
        cachedCount: 3,
        lastLoadedAt: 1_000,
        now: 5_000,
        ttlMs: 10_000,
      }),
    ).toBe(false);

    expect(
      shouldUseRuleSqlListCache({
        forceRefresh: false,
        cachedCount: 0,
        lastLoadedAt: 1_000,
        now: 5_000,
        ttlMs: 10_000,
      }),
    ).toBe(false);

    expect(
      shouldUseRuleSqlListCache({
        forceRefresh: false,
        cachedCount: 3,
        lastLoadedAt: 1_000,
        now: 20_000,
        ttlMs: 10_000,
      }),
    ).toBe(false);
  });
});
