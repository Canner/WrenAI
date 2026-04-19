import {
  WorkbenchEditorMeta,
  WorkbenchEditorMetaText,
  WorkbenchEditorStatusChip,
  WorkbenchEditorTitle,
} from '@/features/knowledgePage/index.styles';

type KnowledgeWorkbenchEditorItemCardMetaProps = {
  metaText: string;
  statusLabel: string;
  statusTone?: 'accent' | 'default';
  title: string;
};

export default function KnowledgeWorkbenchEditorItemCardMeta({
  metaText,
  statusLabel,
  statusTone = 'default',
  title,
}: KnowledgeWorkbenchEditorItemCardMetaProps) {
  return (
    <>
      <WorkbenchEditorTitle>{title}</WorkbenchEditorTitle>
      <WorkbenchEditorMeta>
        <WorkbenchEditorStatusChip $tone={statusTone}>
          {statusLabel}
        </WorkbenchEditorStatusChip>
        <WorkbenchEditorMetaText>{metaText}</WorkbenchEditorMetaText>
      </WorkbenchEditorMeta>
    </>
  );
}
