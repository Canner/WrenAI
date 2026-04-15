import { useCallback } from 'react';

export const runKnowledgeSummaryMoreAction = ({
  key,
  openRuleManageModal,
  openSqlManageModal,
  openEditKnowledgeBaseModal,
}: {
  key: string;
  openRuleManageModal: () => void;
  openSqlManageModal: () => void;
  openEditKnowledgeBaseModal: () => void;
}) => {
  if (key === 'instructions') {
    openRuleManageModal();
    return;
  }

  if (key === 'sql-templates') {
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
}: {
  openRuleManageModal: () => void;
  openSqlManageModal: () => void;
  openEditKnowledgeBaseModal: () => void;
}) {
  return useCallback(
    (key: string) =>
      runKnowledgeSummaryMoreAction({
        key,
        openRuleManageModal,
        openSqlManageModal,
        openEditKnowledgeBaseModal,
      }),
    [openEditKnowledgeBaseModal, openRuleManageModal, openSqlManageModal],
  );
}
