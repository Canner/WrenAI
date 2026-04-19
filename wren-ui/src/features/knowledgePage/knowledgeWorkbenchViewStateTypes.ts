import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchPresentationStateArgs } from './knowledgeWorkbenchPresentationStateTypes';

export type KnowledgeWorkbenchViewStateArgs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = KnowledgeWorkbenchPresentationStateArgs<TKnowledgeBase, TConnector> & {
  activeKnowledgeSnapshotId?: string | null;
  currentKnowledgeBaseId?: string | null;
  hasRuntimeScope: boolean;
  loadRuleList: () => Promise<unknown>;
  loadSqlList: () => Promise<unknown>;
  refetchReady: boolean;
  resetAssetDraft: () => void;
  resetRuleSqlManagerState: () => void;
  routeKnowledgeBaseId?: string | null;
  setAssetModalOpen: (open: boolean) => void;
  setPendingKnowledgeBaseId: (id: string | null) => void;
  setSelectedConnectorId: (id?: string) => void;
  setSelectedDemoTable: (table?: string) => void;
  setSelectedKnowledgeBaseId: (id: string | null) => void;
};
