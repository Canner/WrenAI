import { CopyOutlined, DeleteOutlined } from '@ant-design/icons';
import type { MouseEvent } from 'react';

import {
  WorkbenchEditorActionGroup,
  WorkbenchMiniIconButton,
} from '@/features/knowledgePage/index.styles';

type KnowledgeWorkbenchEditorItemCardActionsProps = {
  deleteTitle: string;
  duplicateTitle: string;
  onDelete: () => void | Promise<void>;
  onDuplicate: () => void | Promise<void>;
};

const stopCardSelection = (event: MouseEvent<HTMLButtonElement>) => {
  event.stopPropagation();
};

export default function KnowledgeWorkbenchEditorItemCardActions({
  deleteTitle,
  duplicateTitle,
  onDelete,
  onDuplicate,
}: KnowledgeWorkbenchEditorItemCardActionsProps) {
  return (
    <WorkbenchEditorActionGroup>
      <WorkbenchMiniIconButton
        type="button"
        title={duplicateTitle}
        onClick={(event) => {
          stopCardSelection(event);
          void onDuplicate();
        }}
      >
        <CopyOutlined />
      </WorkbenchMiniIconButton>
      <WorkbenchMiniIconButton
        type="button"
        $danger
        title={deleteTitle}
        onClick={(event) => {
          stopCardSelection(event);
          void onDelete();
        }}
      >
        <DeleteOutlined />
      </WorkbenchMiniIconButton>
    </WorkbenchEditorActionGroup>
  );
}
