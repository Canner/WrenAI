import CloseOutlined from '@ant-design/icons/CloseOutlined';
import { Form, Input } from 'antd';
import type { FormInstance } from 'antd';
import { memo } from 'react';
import { REFERENCE_MODAL_MASK_STYLE } from '@/features/knowledgePage/constants';
import {
  DarkButton,
  LightButton,
  ModalCloseButton,
  ModalFooter,
  ModalForm,
  ModalHeader,
  ModalIntro,
  ModalPanel,
  ModalTitle,
  ReferenceModal,
  TitleGroup,
} from '@/features/knowledgePage/index.styles';
import type { KnowledgeBaseRecord } from '@/features/knowledgePage/types';

type KnowledgeBaseFormValues = {
  name: string;
  description?: string;
};

type KnowledgeBaseModalProps = {
  visible: boolean;
  editingKnowledgeBase?: KnowledgeBaseRecord | null;
  form: FormInstance<KnowledgeBaseFormValues>;
  canSaveKnowledgeBase: boolean;
  creatingKnowledgeBase: boolean;
  onCancel: () => void;
  onSave: () => void;
};

function KnowledgeBaseModal({
  visible,
  editingKnowledgeBase,
  form,
  canSaveKnowledgeBase,
  creatingKnowledgeBase,
  onCancel,
  onSave,
}: KnowledgeBaseModalProps) {
  return (
    <ReferenceModal
      open={visible}
      title={null}
      footer={null}
      closable={false}
      onCancel={onCancel}
      width={728}
      styles={{ mask: REFERENCE_MODAL_MASK_STYLE }}
      destroyOnHidden
    >
      <ModalPanel>
        <ModalHeader>
          <TitleGroup>
            <ModalTitle>
              {editingKnowledgeBase ? '编辑知识库' : '添加知识库'}
            </ModalTitle>
            <ModalIntro>
              {editingKnowledgeBase
                ? '更新当前知识库名称与描述，让问答范围与业务口径保持一致。'
                : '为当前工作区新增一套独立知识上下文。'}
            </ModalIntro>
          </TitleGroup>
          <ModalCloseButton type="button" onClick={onCancel}>
            <CloseOutlined />
          </ModalCloseButton>
        </ModalHeader>

        <ModalForm form={form as any} layout="vertical">
          <Form.Item
            label="知识库名称"
            name="name"
            rules={[{ required: true, message: '请输入知识库名称' }]}
          >
            <Input
              placeholder={
                editingKnowledgeBase ? '请输入知识库名称' : '请输入新知识库名称'
              }
            />
          </Form.Item>
          <Form.Item label="AI 描述" name="description">
            <Input.TextArea
              rows={4}
              placeholder="补充知识库用途、业务范围、常见别名与分析口径，便于问答阶段更好理解上下文。"
            />
          </Form.Item>
        </ModalForm>

        <ModalFooter>
          <LightButton onClick={onCancel}>取消</LightButton>
          <DarkButton
            disabled={!canSaveKnowledgeBase}
            loading={creatingKnowledgeBase}
            onClick={onSave}
          >
            {editingKnowledgeBase ? '保存修改' : '保存'}
          </DarkButton>
        </ModalFooter>
      </ModalPanel>
    </ReferenceModal>
  );
}

export default memo(KnowledgeBaseModal);
