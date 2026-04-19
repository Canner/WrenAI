import { Instruction, SqlPair } from '@/types/knowledge';
import type { AssetView } from '@/features/knowledgePage/types';
import type {
  RuleDetailFormValues,
  SqlTemplateFormValues,
} from '@/hooks/useKnowledgeRuleSqlManager';

export type KnowledgeWorkbenchDraftStateArgs = {
  detailAssets: AssetView[];
  ruleForm: any;
  ruleList: Instruction[];
  sqlList: SqlPair[];
  sqlTemplateForm: any;
};

export type KnowledgeWorkbenchDraftUiState = {
  ruleDrawerOpen: boolean;
  ruleListScope: 'all' | 'default' | 'matched';
  ruleSearchKeyword: string;
  setRuleDrawerOpen: (open: boolean) => void;
  setRuleListScope: (value: 'all' | 'default' | 'matched') => void;
  setRuleSearchKeyword: (value: string) => void;
  setSqlListMode: (value: 'all' | 'recent') => void;
  setSqlSearchKeyword: (value: string) => void;
  setSqlTemplateDrawerOpen: (open: boolean) => void;
  sqlListMode: 'all' | 'recent';
  sqlSearchKeyword: string;
  sqlTemplateDrawerOpen: boolean;
};

export type KnowledgeWorkbenchDraftWatchValues = {
  watchedRuleContent?: string;
  watchedRuleScope?: 'all' | 'matched';
  watchedRuleSummary?: string;
  watchedSqlContent?: string;
  watchedSqlDescription?: string;
};

export type KnowledgeWorkbenchDraftBaselineState = {
  ruleDraftBaseline: RuleDetailFormValues;
  sqlDraftBaseline: SqlTemplateFormValues;
  syncRuleDraftBaseline: (values?: Record<string, any>) => void;
  syncSqlDraftBaseline: (values?: Record<string, any>) => void;
};

export type KnowledgeWorkbenchContextAssetState = {
  ruleContextAsset?: AssetView | null;
  ruleContextAssetId?: string;
  setRuleContextAssetId: (value?: string) => void;
  setSqlContextAssetId: (value?: string) => void;
  sqlContextAsset?: AssetView | null;
  sqlContextAssetId?: string;
  sqlTemplateAssetOptions: Array<{ label: string; value: string }>;
};

export type KnowledgeWorkbenchDraftDerivedState = {
  isRuleDraftDirty: boolean;
  isSqlDraftDirty: boolean;
  visibleRuleList: Instruction[];
  visibleSqlList: SqlPair[];
};

export function buildKnowledgeWorkbenchDraftDerivedStateInput({
  args,
  baselineState,
  uiState,
  watchValues,
}: {
  args: KnowledgeWorkbenchDraftStateArgs;
  baselineState: KnowledgeWorkbenchDraftBaselineState;
  uiState: KnowledgeWorkbenchDraftUiState;
  watchValues: KnowledgeWorkbenchDraftWatchValues;
}) {
  return {
    ruleDraftBaseline: baselineState.ruleDraftBaseline,
    ruleList: args.ruleList,
    ruleListScope: uiState.ruleListScope,
    ruleSearchKeyword: uiState.ruleSearchKeyword,
    sqlDraftBaseline: baselineState.sqlDraftBaseline,
    sqlList: args.sqlList,
    sqlListMode: uiState.sqlListMode,
    sqlSearchKeyword: uiState.sqlSearchKeyword,
    watchedRuleContent: watchValues.watchedRuleContent,
    watchedRuleScope: watchValues.watchedRuleScope,
    watchedRuleSummary: watchValues.watchedRuleSummary,
    watchedSqlContent: watchValues.watchedSqlContent,
    watchedSqlDescription: watchValues.watchedSqlDescription,
  };
}

export function buildKnowledgeWorkbenchDraftStateResult({
  baselineState,
  contextAssetState,
  derivedState,
  uiState,
}: {
  baselineState: KnowledgeWorkbenchDraftBaselineState;
  contextAssetState: KnowledgeWorkbenchContextAssetState;
  derivedState: KnowledgeWorkbenchDraftDerivedState;
  uiState: KnowledgeWorkbenchDraftUiState;
}) {
  return {
    ...derivedState,
    ...contextAssetState,
    ruleDrawerOpen: uiState.ruleDrawerOpen,
    ruleListScope: uiState.ruleListScope,
    ruleSearchKeyword: uiState.ruleSearchKeyword,
    setRuleDrawerOpen: uiState.setRuleDrawerOpen,
    setRuleListScope: uiState.setRuleListScope,
    setRuleSearchKeyword: uiState.setRuleSearchKeyword,
    setSqlListMode: uiState.setSqlListMode,
    setSqlSearchKeyword: uiState.setSqlSearchKeyword,
    setSqlTemplateDrawerOpen: uiState.setSqlTemplateDrawerOpen,
    sqlListMode: uiState.sqlListMode,
    sqlSearchKeyword: uiState.sqlSearchKeyword,
    sqlTemplateDrawerOpen: uiState.sqlTemplateDrawerOpen,
    syncRuleDraftBaseline: baselineState.syncRuleDraftBaseline,
    syncSqlDraftBaseline: baselineState.syncSqlDraftBaseline,
  };
}
