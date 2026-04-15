import { useState } from 'react';
import { message } from 'antd';

type KnowledgeBaseEditable = {
  id?: string;
  name?: string | null;
  description?: string | null;
};

type KnowledgeBaseForm = {
  setFieldsValue: (values: { name: string; description?: string }) => void;
  resetFields: () => void;
};

export default function useKnowledgeBaseModal<
  TKnowledgeBase extends KnowledgeBaseEditable,
>({
  canCreateKnowledgeBase,
  createKnowledgeBaseBlockedReason,
  isKnowledgeMutationDisabled,
  isSnapshotReadonlyKnowledgeBase,
  snapshotReadonlyHint,
  isReadonlyKnowledgeBase,
  activeKnowledgeBase,
  kbForm,
  openModalSafely,
}: {
  canCreateKnowledgeBase: boolean;
  createKnowledgeBaseBlockedReason: string;
  isKnowledgeMutationDisabled: boolean;
  isSnapshotReadonlyKnowledgeBase: boolean;
  snapshotReadonlyHint: string;
  isReadonlyKnowledgeBase: boolean;
  activeKnowledgeBase?: TKnowledgeBase | null;
  kbForm: KnowledgeBaseForm;
  openModalSafely: (action: () => void) => void;
}) {
  const [kbModalOpen, setKbModalOpen] = useState(false);
  const [editingKnowledgeBase, setEditingKnowledgeBase] =
    useState<TKnowledgeBase | null>(null);

  const closeKnowledgeBaseModal = () => {
    setKbModalOpen(false);
    setEditingKnowledgeBase(null);
    kbForm.resetFields();
  };

  const openCreateKnowledgeBaseModal = () => {
    if (!canCreateKnowledgeBase) {
      message.info(createKnowledgeBaseBlockedReason);
      return;
    }

    setEditingKnowledgeBase(null);
    kbForm.setFieldsValue({
      name: '',
      description: '',
    });
    openModalSafely(() => {
      setKbModalOpen(true);
    });
  };

  const openEditKnowledgeBaseModal = () => {
    if (!activeKnowledgeBase || isKnowledgeMutationDisabled) {
      if (isSnapshotReadonlyKnowledgeBase) {
        message.info(snapshotReadonlyHint);
        return;
      }

      if (isReadonlyKnowledgeBase) {
        message.info('系统样例知识库不支持编辑');
      }
      return;
    }

    setEditingKnowledgeBase(activeKnowledgeBase);
    kbForm.setFieldsValue({
      name: activeKnowledgeBase.name || '',
      description: activeKnowledgeBase.description || '',
    });
    openModalSafely(() => {
      setKbModalOpen(true);
    });
  };

  return {
    kbModalOpen,
    editingKnowledgeBase,
    closeKnowledgeBaseModal,
    openCreateKnowledgeBaseModal,
    openEditKnowledgeBaseModal,
  };
}
