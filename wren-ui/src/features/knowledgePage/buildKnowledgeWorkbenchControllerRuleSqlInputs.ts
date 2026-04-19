import useKnowledgeWorkbenchRuleSql from './useKnowledgeWorkbenchRuleSql';
import type { KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchControllerOperationsArgs } from './knowledgeWorkbenchControllerOperationsTypes';

export function buildKnowledgeWorkbenchRuleSqlInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
>({
  activeKnowledgeRuntimeSelector,
  ruleForm,
  ruleSqlCacheScopeKey,
  sqlTemplateForm,
}: KnowledgeWorkbenchControllerOperationsArgs<TKnowledgeBase>): Parameters<
  typeof useKnowledgeWorkbenchRuleSql
>[0] {
  return {
    cacheScopeKey: ruleSqlCacheScopeKey,
    runtimeSelector: activeKnowledgeRuntimeSelector,
    ruleForm,
    sqlTemplateForm,
  };
}

export default buildKnowledgeWorkbenchRuleSqlInputs;
