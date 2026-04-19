import useKnowledgeWorkbenchActions from './useKnowledgeWorkbenchActions';
import useKnowledgeWorkbenchRuleSql from './useKnowledgeWorkbenchRuleSql';
import type { KnowledgeBaseRecord } from './types';

export type KnowledgeWorkbenchControllerOperationsArgs<
  TKnowledgeBase extends KnowledgeBaseRecord,
> = {
  activeKnowledgeBase?: TKnowledgeBase | null;
  activeKnowledgeRuntimeSelector: Parameters<
    typeof useKnowledgeWorkbenchRuleSql
  >[0]['runtimeSelector'];
  buildRuntimeScopeUrl: Parameters<
    typeof useKnowledgeWorkbenchActions<TKnowledgeBase>
  >[0]['buildRuntimeScopeUrl'];
  canCreateKnowledgeBase: boolean;
  createKnowledgeBaseBlockedReason: string;
  currentKnowledgeBaseId?: string | null;
  isKnowledgeMutationDisabled: boolean;
  isReadonlyKnowledgeBase: boolean;
  isSnapshotReadonlyKnowledgeBase: boolean;
  kbForm: Parameters<
    typeof useKnowledgeWorkbenchActions<TKnowledgeBase>
  >[0]['kbForm'];
  loadKnowledgeBases: Parameters<
    typeof useKnowledgeWorkbenchActions<TKnowledgeBase>
  >[0]['loadKnowledgeBases'];
  pushRoute: Parameters<
    typeof useKnowledgeWorkbenchActions<TKnowledgeBase>
  >[0]['pushRoute'];
  refetchRuntimeSelector: Parameters<
    typeof useKnowledgeWorkbenchActions<TKnowledgeBase>
  >[0]['refetchRuntimeSelector'];
  resetAssetDraft: Parameters<
    typeof useKnowledgeWorkbenchActions<TKnowledgeBase>
  >[0]['resetAssetDraft'];
  router: Parameters<
    typeof useKnowledgeWorkbenchActions<TKnowledgeBase>
  >[0]['router'];
  routerAsPath: string;
  ruleForm: Parameters<typeof useKnowledgeWorkbenchRuleSql>[0]['ruleForm'];
  ruleSqlCacheScopeKey?: string | null;
  runtimeNavigationSelector: Parameters<
    typeof useKnowledgeWorkbenchActions<TKnowledgeBase>
  >[0]['runtimeNavigationSelector'];
  setAssetModalOpen: Parameters<
    typeof useKnowledgeWorkbenchActions<TKnowledgeBase>
  >[0]['setAssetModalOpen'];
  setAssetWizardStep: Parameters<
    typeof useKnowledgeWorkbenchActions<TKnowledgeBase>
  >[0]['setAssetWizardStep'];
  setDetailAsset: Parameters<
    typeof useKnowledgeWorkbenchActions<TKnowledgeBase>
  >[0]['setDetailAsset'];
  setSelectedKnowledgeBaseId: Parameters<
    typeof useKnowledgeWorkbenchActions<TKnowledgeBase>
  >[0]['setSelectedKnowledgeBaseId'];
  snapshotReadonlyHint: string;
  sqlTemplateForm: Parameters<
    typeof useKnowledgeWorkbenchRuleSql
  >[0]['sqlTemplateForm'];
};
