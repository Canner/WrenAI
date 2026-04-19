import useKnowledgeRuleSqlActions from '@/hooks/useKnowledgeRuleSqlActions';
import useKnowledgeRuleSqlManager from '@/hooks/useKnowledgeRuleSqlManager';

export function useKnowledgeWorkbenchRuleSql({
  cacheScopeKey,
  runtimeSelector,
  ruleForm,
  sqlTemplateForm,
}: {
  cacheScopeKey?: string | null;
  runtimeSelector: Parameters<typeof useKnowledgeRuleSqlActions>[0];
  ruleForm: Parameters<typeof useKnowledgeRuleSqlManager>[0]['ruleForm'];
  sqlTemplateForm: Parameters<
    typeof useKnowledgeRuleSqlManager
  >[0]['sqlTemplateForm'];
}) {
  const {
    createInstructionLoading,
    updateInstructionLoading,
    createSqlPairLoading,
    updateSqlPairLoading,
    createInstruction,
    updateInstruction,
    deleteInstruction,
    createSqlPair,
    updateSqlPair,
    deleteSqlPair,
    refetchInstructions,
    refetchSqlPairs,
  } = useKnowledgeRuleSqlActions(runtimeSelector);

  const manager = useKnowledgeRuleSqlManager({
    ruleForm,
    sqlTemplateForm,
    cacheScopeKey,
    refetchInstructions,
    refetchSqlPairs,
    createInstruction,
    updateInstruction,
    deleteInstruction,
    createSqlPair,
    updateSqlPair,
    deleteSqlPair,
  });

  return {
    createInstructionLoading,
    createSqlPairLoading,
    updateInstructionLoading,
    updateSqlPairLoading,
    ...manager,
  };
}

export default useKnowledgeWorkbenchRuleSql;
