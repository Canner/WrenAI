import {
  WorkbenchEditorCard,
  WorkbenchEditorCardHead,
  WorkbenchEditorCardMain,
  WorkbenchEditorDesc,
} from '@/features/knowledgePage/index.styles';

import KnowledgeWorkbenchEditorItemCardActions from './KnowledgeWorkbenchEditorItemCardActions';
import KnowledgeWorkbenchEditorItemCardMeta from './KnowledgeWorkbenchEditorItemCardMeta';

type KnowledgeWorkbenchEditorItemCardProps = {
  active: boolean;
  deleteTitle: string;
  description: string;
  duplicateTitle: string;
  isReadonly: boolean;
  metaText: string;
  statusLabel: string;
  statusTone?: 'accent' | 'default';
  title: string;
  onDelete: () => void | Promise<void>;
  onDuplicate: () => void | Promise<void>;
  onSelect: () => void;
};

export default function KnowledgeWorkbenchEditorItemCard({
  active,
  deleteTitle,
  description,
  duplicateTitle,
  isReadonly,
  metaText,
  statusLabel,
  statusTone = 'default',
  title,
  onDelete,
  onDuplicate,
  onSelect,
}: KnowledgeWorkbenchEditorItemCardProps) {
  return (
    <WorkbenchEditorCard type="button" $active={active} onClick={onSelect}>
      <WorkbenchEditorCardHead>
        <WorkbenchEditorCardMain>
          <KnowledgeWorkbenchEditorItemCardMeta
            metaText={metaText}
            statusLabel={statusLabel}
            statusTone={statusTone}
            title={title}
          />
        </WorkbenchEditorCardMain>
        {isReadonly ? null : (
          <KnowledgeWorkbenchEditorItemCardActions
            deleteTitle={deleteTitle}
            duplicateTitle={duplicateTitle}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
          />
        )}
      </WorkbenchEditorCardHead>
      <WorkbenchEditorDesc>{description}</WorkbenchEditorDesc>
    </WorkbenchEditorCard>
  );
}
