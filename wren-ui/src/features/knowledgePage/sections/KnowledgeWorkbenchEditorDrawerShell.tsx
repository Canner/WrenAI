import { Drawer } from 'antd';
import type { ReactNode } from 'react';

import KnowledgeWorkbenchEditorDrawerFooter from './KnowledgeWorkbenchEditorDrawerFooter';
import {
  WORKBENCH_EDITOR_DRAWER_BODY_STYLE,
  WORKBENCH_EDITOR_DRAWER_CONTENT_STYLE,
  WORKBENCH_EDITOR_DRAWER_WIDTH,
} from './knowledgeWorkbenchShared';

type KnowledgeWorkbenchEditorDrawerShellProps = {
  children: ReactNode;
  isReadonly: boolean;
  loading: boolean;
  open: boolean;
  saveLabel: string;
  onClose: () => void | Promise<void>;
  onReset: () => void;
  onSubmit: () => void | Promise<void>;
};

export default function KnowledgeWorkbenchEditorDrawerShell({
  children,
  isReadonly,
  loading,
  open,
  saveLabel,
  onClose,
  onReset,
  onSubmit,
}: KnowledgeWorkbenchEditorDrawerShellProps) {
  return (
    <Drawer
      destroyOnHidden={false}
      onClose={() => void onClose()}
      open={open}
      size={WORKBENCH_EDITOR_DRAWER_WIDTH}
      closable={false}
      title={null}
      styles={{
        body: WORKBENCH_EDITOR_DRAWER_BODY_STYLE,
        header: { display: 'none' },
      }}
    >
      <div style={WORKBENCH_EDITOR_DRAWER_CONTENT_STYLE}>{children}</div>
      <KnowledgeWorkbenchEditorDrawerFooter
        isReadonly={isReadonly}
        loading={loading}
        saveLabel={saveLabel}
        onClose={onClose}
        onReset={onReset}
        onSubmit={onSubmit}
      />
    </Drawer>
  );
}
