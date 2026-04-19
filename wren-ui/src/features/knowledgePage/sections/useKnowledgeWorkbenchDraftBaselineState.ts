import { useCallback, useState } from 'react';
import {
  EMPTY_RULE_EDITOR_VALUES,
  EMPTY_SQL_TEMPLATE_VALUES,
} from '@/utils/knowledgeWorkbenchEditor';
import type {
  RuleDetailFormValues,
  SqlTemplateFormValues,
} from '@/hooks/useKnowledgeRuleSqlManager';

export function useKnowledgeWorkbenchDraftBaselineState({
  ruleForm,
  sqlTemplateForm,
}: {
  ruleForm: {
    getFieldsValue: (names: string[]) => Record<string, any>;
  };
  sqlTemplateForm: {
    getFieldsValue: (names: string[]) => Record<string, any>;
  };
}) {
  const [sqlDraftBaseline, setSqlDraftBaseline] =
    useState<SqlTemplateFormValues>(EMPTY_SQL_TEMPLATE_VALUES);
  const [ruleDraftBaseline, setRuleDraftBaseline] =
    useState<RuleDetailFormValues>(EMPTY_RULE_EDITOR_VALUES);

  const readSqlDraftValues = useCallback(
    (): SqlTemplateFormValues => ({
      ...EMPTY_SQL_TEMPLATE_VALUES,
      ...sqlTemplateForm.getFieldsValue(['description', 'sql', 'scope']),
    }),
    [sqlTemplateForm],
  );

  const readRuleDraftValues = useCallback(
    (): RuleDetailFormValues => ({
      ...EMPTY_RULE_EDITOR_VALUES,
      ...ruleForm.getFieldsValue(['summary', 'scope', 'content']),
    }),
    [ruleForm],
  );

  const syncSqlDraftBaseline = useCallback(
    (nextValues?: Partial<SqlTemplateFormValues> | null) => {
      setSqlDraftBaseline({
        ...EMPTY_SQL_TEMPLATE_VALUES,
        ...(nextValues || readSqlDraftValues()),
      });
    },
    [readSqlDraftValues],
  );

  const syncRuleDraftBaseline = useCallback(
    (nextValues?: Partial<RuleDetailFormValues> | null) => {
      setRuleDraftBaseline({
        ...EMPTY_RULE_EDITOR_VALUES,
        ...(nextValues || readRuleDraftValues()),
      });
    },
    [readRuleDraftValues],
  );

  return {
    ruleDraftBaseline,
    sqlDraftBaseline,
    syncRuleDraftBaseline,
    syncSqlDraftBaseline,
  };
}
