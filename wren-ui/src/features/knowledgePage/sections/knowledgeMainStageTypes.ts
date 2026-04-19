import type { KnowledgeDetailFieldFilter } from '@/hooks/useKnowledgeAssetDetail';
import type {
  KnowledgeAssetDetailField,
  KnowledgeWorkbenchDetailTab,
  KnowledgeWorkbenchModelingSummary,
  KnowledgeWorkbenchSectionKey,
} from '@/features/knowledgePage/sections/knowledgeWorkbenchShared';
import type { AssetView } from '@/features/knowledgePage/types';
import type { Instruction, SqlPair } from '@/types/knowledge';

export type KnowledgeMainStageProps = {
  activeWorkbenchSection: KnowledgeWorkbenchSectionKey;
  onChangeWorkbenchSection: (nextSection: KnowledgeWorkbenchSectionKey) => void;
  previewFieldCount: number;
  isSnapshotReadonlyKnowledgeBase: boolean;
  isReadonlyKnowledgeBase: boolean;
  isKnowledgeMutationDisabled: boolean;
  knowledgeMutationHint?: string | null;
  knowledgeDescription?: string | null;
  showKnowledgeAssetsLoading: boolean;
  detailAssets: AssetView[];
  activeDetailAsset?: AssetView | null;
  detailTab: KnowledgeWorkbenchDetailTab;
  detailFieldKeyword: string;
  detailFieldFilter: KnowledgeDetailFieldFilter;
  detailAssetFields: KnowledgeAssetDetailField[];
  onOpenAssetWizard: () => void;
  onOpenKnowledgeEditor: () => void;
  onOpenAssetDetail: (asset: AssetView) => void;
  onCloseAssetDetail: () => void;
  onCreateRuleDraftFromAsset?: (asset: AssetView) => void;
  onCreateSqlTemplateDraftFromAsset?: (asset: AssetView) => void;
  onChangeDetailTab: (tab: KnowledgeWorkbenchDetailTab) => void;
  onChangeFieldKeyword: (keyword: string) => void;
  onChangeFieldFilter: (filter: KnowledgeDetailFieldFilter) => void;
  historicalSnapshotReadonlyHint: string;
  ruleList: Instruction[];
  sqlList: SqlPair[];
  ruleManageLoading: boolean;
  sqlManageLoading: boolean;
  onOpenRuleDetail: (instruction?: Instruction) => void;
  onOpenSqlTemplateDetail: (sqlPair?: SqlPair) => void;
  onDeleteRule: (instruction: Instruction) => Promise<void> | void;
  onDeleteSqlTemplate: (sqlPair: SqlPair) => Promise<void> | void;
  editingInstruction?: Instruction | null;
  editingSqlPair?: SqlPair | null;
  ruleForm: any;
  sqlTemplateForm: any;
  createInstructionLoading: boolean;
  updateInstructionLoading: boolean;
  createSqlPairLoading: boolean;
  updateSqlPairLoading: boolean;
  onSubmitRuleDetail: () => Promise<void> | void;
  onSubmitSqlTemplateDetail: () => Promise<void> | void;
  onResetRuleDetailEditor: () => void;
  onResetSqlTemplateEditor: () => void;
  modelingWorkspaceKey: string;
  modelingSummary?: KnowledgeWorkbenchModelingSummary;
  onOpenModeling: () => void;
};
