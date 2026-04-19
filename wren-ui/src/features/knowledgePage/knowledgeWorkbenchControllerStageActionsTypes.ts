import type { KnowledgeBaseRecord } from './types';

export type ActionsInput = {
  buildKnowledgeRuntimeSelector: (...args: any[]) => any;
  closeAssetModal: () => void;
  closeKnowledgeBaseModal: () => void;
  creatingKnowledgeBase: boolean;
  editingKnowledgeBase: KnowledgeBaseRecord | null;
  handleSaveKnowledgeBase: () => Promise<void> | void;
  kbModalOpen: boolean;
  openConnectorConsole: () => void;
  openCreateKnowledgeBaseModal: () => void;
  openEditKnowledgeBaseModal: () => void;
};
