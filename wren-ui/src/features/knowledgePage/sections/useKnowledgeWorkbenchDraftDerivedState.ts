import { useMemo } from 'react';
import type {
  RuleDetailFormValues,
  SqlTemplateFormValues,
} from '@/hooks/useKnowledgeRuleSqlManager';
import type { Instruction, SqlPair } from '@/types/knowledge';
import {
  filterKnowledgeInstructions,
  filterKnowledgeSqlTemplates,
  hasRuleDraftChanges,
  hasSqlTemplateDraftChanges,
} from '@/utils/knowledgeWorkbenchEditor';

export function useKnowledgeWorkbenchDraftDerivedState({
  ruleDraftBaseline,
  ruleList,
  ruleListScope,
  ruleSearchKeyword,
  sqlDraftBaseline,
  sqlList,
  sqlListMode,
  sqlSearchKeyword,
  watchedRuleContent,
  watchedRuleScope,
  watchedRuleSummary,
  watchedSqlContent,
  watchedSqlDescription,
}: {
  ruleDraftBaseline: RuleDetailFormValues;
  ruleList: Instruction[];
  ruleListScope: 'all' | 'default' | 'matched';
  ruleSearchKeyword: string;
  sqlDraftBaseline: SqlTemplateFormValues;
  sqlList: SqlPair[];
  sqlListMode: 'all' | 'recent';
  sqlSearchKeyword: string;
  watchedRuleContent?: string;
  watchedRuleScope?: 'all' | 'matched';
  watchedRuleSummary?: string;
  watchedSqlContent?: string;
  watchedSqlDescription?: string;
}) {
  const visibleSqlList = useMemo(
    () =>
      filterKnowledgeSqlTemplates({
        sqlList,
        keyword: sqlSearchKeyword,
        mode: sqlListMode,
      }),
    [sqlList, sqlListMode, sqlSearchKeyword],
  );

  const visibleRuleList = useMemo(
    () =>
      filterKnowledgeInstructions({
        ruleList,
        keyword: ruleSearchKeyword,
        scope: ruleListScope,
      }),
    [ruleList, ruleListScope, ruleSearchKeyword],
  );

  const isRuleDraftDirty = useMemo(
    () =>
      hasRuleDraftChanges({
        currentValues: {
          summary: watchedRuleSummary,
          scope: watchedRuleScope,
          content: watchedRuleContent,
        },
        initialValues: ruleDraftBaseline,
      }),
    [
      ruleDraftBaseline,
      watchedRuleContent,
      watchedRuleScope,
      watchedRuleSummary,
    ],
  );

  const isSqlDraftDirty = useMemo(
    () =>
      hasSqlTemplateDraftChanges({
        currentValues: {
          description: watchedSqlDescription,
          sql: watchedSqlContent,
        },
        initialValues: sqlDraftBaseline,
      }),
    [sqlDraftBaseline, watchedSqlContent, watchedSqlDescription],
  );

  return {
    isRuleDraftDirty,
    isSqlDraftDirty,
    visibleRuleList,
    visibleSqlList,
  };
}
