import { PlusOutlined } from '@ant-design/icons';

import {
  WorkbenchCreateCard,
  WorkbenchCreateCardIcon,
  WorkbenchCreateCardMeta,
  WorkbenchCreateCardTitle,
  WorkbenchCreateCardTop,
} from '@/features/knowledgePage/index.styles';

type KnowledgeWorkbenchCreateEditorCardProps = {
  description: string;
  title: string;
  onClick: () => void;
};

export default function KnowledgeWorkbenchCreateEditorCard({
  description,
  title,
  onClick,
}: KnowledgeWorkbenchCreateEditorCardProps) {
  return (
    <WorkbenchCreateCard type="button" onClick={onClick}>
      <WorkbenchCreateCardTop>
        <WorkbenchCreateCardIcon>
          <PlusOutlined />
        </WorkbenchCreateCardIcon>
        <WorkbenchCreateCardTitle>{title}</WorkbenchCreateCardTitle>
      </WorkbenchCreateCardTop>
      <WorkbenchCreateCardMeta>{description}</WorkbenchCreateCardMeta>
    </WorkbenchCreateCard>
  );
}
