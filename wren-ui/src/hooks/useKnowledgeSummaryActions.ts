import { useCallback } from 'react';

export const runKnowledgeSummaryMoreAction = ({
  key,
  openRuleManageModal,
  openSqlManageModal,
  openEditKnowledgeBaseModal,
  onNavigateWorkbenchSection,
}: {
  key: string;
  openRuleManageModal: () => void;
  openSqlManageModal: () => void;
  openEditKnowledgeBaseModal: () => void;
  onNavigateWorkbenchSection?: (
    section: 'instructions' | 'sqlTemplates',
  ) => void;
}) => {
  if (key === 'instructions') {
    if (onNavigateWorkbenchSection) {
      onNavigateWorkbenchSection('instructions');
      return;
    }
    openRuleManageModal();
    return;
  }

  if (key === 'sql-templates') {
    if (onNavigateWorkbenchSection) {
      onNavigateWorkbenchSection('sqlTemplates');
      return;
    }
    openSqlManageModal();
    return;
  }

  if (key === 'edit-knowledge') {
    openEditKnowledgeBaseModal();
  }
};

export default function useKnowledgeSummaryActions({
  openRuleManageModal,
  openSqlManageModal,
  openEditKnowledgeBaseModal,
  onNavigateWorkbenchSection,
}: {
  openRuleManageModal: () => void;
  openSqlManageModal: () => void;
  openEditKnowledgeBaseModal: () => void;
  onNavigateWorkbenchSection?: (
    section: 'instructions' | 'sqlTemplates',
  ) => void;
}) {
  return useCallback(
    (key: string) =>
      runKnowledgeSummaryMoreAction({
        key,
        openRuleManageModal,
        openSqlManageModal,
        openEditKnowledgeBaseModal,
        onNavigateWorkbenchSection,
      }),
    [
      onNavigateWorkbenchSection,
      openEditKnowledgeBaseModal,
      openRuleManageModal,
      openSqlManageModal,
    ],
  );
}
