import {
  buildKnowledgeWorkbenchRuleActionLaneInput,
  buildKnowledgeWorkbenchSaveShortcutInput,
  buildKnowledgeWorkbenchSectionChangeGuardInput,
  buildKnowledgeWorkbenchSqlActionLaneInput,
} from './buildKnowledgeWorkbenchEditorActionLaneInputs';
import type { KnowledgeWorkbenchEditorActionsArgs } from './knowledgeWorkbenchEditorActionsTypes';
import { buildKnowledgeWorkbenchEditorActionsResult } from './buildKnowledgeWorkbenchEditorActionsResult';
import { useKnowledgeWorkbenchDirtyGuards } from './useKnowledgeWorkbenchDirtyGuards';
import { useKnowledgeWorkbenchRuleActions } from './useKnowledgeWorkbenchRuleActions';
import { useKnowledgeWorkbenchSaveShortcut } from './useKnowledgeWorkbenchSaveShortcut';
import { useKnowledgeWorkbenchSectionChangeGuard } from './useKnowledgeWorkbenchSectionChangeGuard';
import { useKnowledgeWorkbenchSqlActions } from './useKnowledgeWorkbenchSqlActions';

export function useKnowledgeWorkbenchEditorActions({
  activeWorkbenchSection,
  ruleDrawerOpen,
  sqlTemplateDrawerOpen,
  ...args
}: KnowledgeWorkbenchEditorActionsArgs) {
  const { confirmDeleteEntry, runWithDirtyGuard } =
    useKnowledgeWorkbenchDirtyGuards();

  const handleWorkbenchSectionChange = useKnowledgeWorkbenchSectionChangeGuard({
    ...buildKnowledgeWorkbenchSectionChangeGuardInput({
      args: {
        activeWorkbenchSection,
        isRuleDraftDirty: args.isRuleDraftDirty,
        isSqlDraftDirty: args.isSqlDraftDirty,
        onChangeWorkbenchSection: args.onChangeWorkbenchSection,
        setRuleDrawerOpen: args.setRuleDrawerOpen,
        setSqlTemplateDrawerOpen: args.setSqlTemplateDrawerOpen,
      },
      runWithDirtyGuard,
    }),
  });

  const sqlActions = useKnowledgeWorkbenchSqlActions({
    ...buildKnowledgeWorkbenchSqlActionLaneInput({
      args: {
        activeWorkbenchSection,
        ruleDrawerOpen,
        sqlTemplateDrawerOpen,
        ...args,
      },
      runWithDirtyGuard,
      confirmDeleteEntry,
    }),
  });

  const ruleActions = useKnowledgeWorkbenchRuleActions({
    ...buildKnowledgeWorkbenchRuleActionLaneInput({
      args: {
        activeWorkbenchSection,
        ruleDrawerOpen,
        sqlTemplateDrawerOpen,
        ...args,
      },
      runWithDirtyGuard,
      confirmDeleteEntry,
    }),
  });

  useKnowledgeWorkbenchSaveShortcut(
    buildKnowledgeWorkbenchSaveShortcutInput({
      activeWorkbenchSection,
      handleSubmitRuleDetail: ruleActions.handleSubmitRuleDetail,
      handleSubmitSqlTemplateDetail: sqlActions.handleSubmitSqlTemplateDetail,
      ruleDrawerOpen,
      sqlTemplateDrawerOpen,
    }),
  );

  return buildKnowledgeWorkbenchEditorActionsResult({
    handleWorkbenchSectionChange,
    ruleActions,
    sqlActions,
  });
}
