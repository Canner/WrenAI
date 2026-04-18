import {
  EMPTY_RULE_EDITOR_VALUES,
  EMPTY_SQL_TEMPLATE_VALUES,
  buildRuleDraftFromAsset,
  buildSqlTemplateDraftFromAsset,
  filterKnowledgeInstructions,
  filterKnowledgeSqlTemplates,
  hasRuleDraftChanges,
  hasSqlTemplateDraftChanges,
  summarizeAssetFieldGovernance,
} from './knowledgeWorkbenchEditor';

describe('knowledgeWorkbenchEditor', () => {
  it('builds an sql template draft from asset context', () => {
    expect(
      buildSqlTemplateDraftFromAsset({
        name: '订单明细',
        sourceTableName: 'fact_orders',
        sourceSql: null,
        suggestedQuestions: ['订单明细里最近 30 天的订单趋势'],
      }),
    ).toEqual({
      scope: 'all',
      description: '订单明细里最近 30 天的订单趋势',
      sql: expect.stringContaining('FROM fact_orders'),
    });
  });

  it('builds a rule draft from asset context', () => {
    const draft = buildRuleDraftFromAsset({
      name: '订单明细',
      description: '订单主事实表',
      primaryKey: 'order_id',
      sourceTableName: 'fact_orders',
      relationCount: 2,
      fieldCount: 18,
      suggestedQuestions: ['订单明细的 GMV 口径是什么'],
    });

    expect(draft.summary).toBe('订单明细的 GMV 口径是什么');
    expect(draft.scope).toBe('matched');
    expect(draft.content).toContain('业务背景：订单主事实表');
    expect(draft.content).toContain('主键 / 唯一标识：order_id');
  });

  it('filters sql templates by keyword and recent mode', () => {
    const results = filterKnowledgeSqlTemplates({
      keyword: 'gmv',
      mode: 'recent',
      sqlList: [
        {
          id: 1,
          question: 'GMV 趋势',
          sql: 'select gmv from t',
          updatedAt: '2026-04-16T10:00:00.000Z',
        },
        {
          id: 2,
          question: '订单量趋势',
          sql: 'select order_count from t',
          updatedAt: '2026-04-17T10:00:00.000Z',
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
  });

  it('filters rules by scope and keyword', () => {
    const results = filterKnowledgeInstructions({
      keyword: 'GMV',
      scope: 'matched',
      ruleList: [
        {
          id: 1,
          createdAt: '2026-04-16T10:00:00.000Z',
          updatedAt: '2026-04-16T10:00:00.000Z',
          isDefault: true,
          questions: [],
          instruction: '【规则描述】默认规则\n【规则内容】默认内容',
        },
        {
          id: 2,
          createdAt: '2026-04-17T10:00:00.000Z',
          updatedAt: '2026-04-17T10:00:00.000Z',
          isDefault: false,
          questions: ['GMV 口径'],
          instruction: '【规则描述】GMV 口径\n【规则内容】GMV = 已支付金额',
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(2);
  });

  it('detects dirty sql and rule drafts', () => {
    expect(
      hasSqlTemplateDraftChanges({
        editingSqlPair: {
          id: 1,
          question: 'GMV',
          sql: 'select 1',
          updatedAt: null,
        },
        currentValues: { description: 'GMV', sql: 'select 2', scope: 'all' },
      }),
    ).toBe(true);

    expect(
      hasRuleDraftChanges({
        editingInstruction: {
          id: 1,
          createdAt: '2026-04-16T10:00:00.000Z',
          updatedAt: '2026-04-16T10:00:00.000Z',
          isDefault: false,
          questions: ['GMV 口径'],
          instruction: '【规则描述】GMV 口径\n【规则内容】GMV = 已支付金额',
        },
        currentValues: {
          summary: 'GMV 口径',
          content: 'GMV = 已支付金额',
          scope: 'matched',
        },
      }),
    ).toBe(false);
  });

  it('keeps sql template draft clean when current values equal baseline', () => {
    expect(
      hasSqlTemplateDraftChanges({
        currentValues: EMPTY_SQL_TEMPLATE_VALUES,
        initialValues: EMPTY_SQL_TEMPLATE_VALUES,
      }),
    ).toBe(false);
  });

  it('keeps rule draft clean when current values equal baseline', () => {
    expect(
      hasRuleDraftChanges({
        currentValues: EMPTY_RULE_EDITOR_VALUES,
        initialValues: EMPTY_RULE_EDITOR_VALUES,
      }),
    ).toBe(false);
  });

  it('summarizes asset field governance gaps', () => {
    expect(
      summarizeAssetFieldGovernance([
        {
          isPrimaryKey: true,
          note: '主键',
          isCalculated: false,
          nestedFields: [],
        },
        { isPrimaryKey: false, note: '', isCalculated: true, nestedFields: [] },
        {
          isPrimaryKey: false,
          note: null,
          isCalculated: false,
          nestedFields: [{ id: 'n1', referenceName: 'items' }],
        },
      ]),
    ).toEqual({
      totalCount: 3,
      notedCount: 1,
      missingNoteCount: 2,
      primaryCount: 1,
      calculatedCount: 1,
      nestedCount: 1,
    });
  });
});
