import { Button } from 'antd';

import {
  WORKBENCH_EDITOR_DRAWER_FOOTER_GROUP_STYLE,
  WORKBENCH_EDITOR_DRAWER_FOOTER_STYLE,
} from './knowledgeWorkbenchShared';

type KnowledgeWorkbenchEditorDrawerFooterProps = {
  isReadonly: boolean;
  loading: boolean;
  saveLabel: string;
  onClose: () => void | Promise<void>;
  onReset: () => void;
  onSubmit: () => void | Promise<void>;
};

export default function KnowledgeWorkbenchEditorDrawerFooter({
  isReadonly,
  loading,
  saveLabel,
  onClose,
  onReset,
  onSubmit,
}: KnowledgeWorkbenchEditorDrawerFooterProps) {
  return (
    <div style={WORKBENCH_EDITOR_DRAWER_FOOTER_STYLE}>
      <div style={WORKBENCH_EDITOR_DRAWER_FOOTER_GROUP_STYLE}>
        {!isReadonly ? <Button onClick={onReset}>重置</Button> : null}
      </div>
      <div style={WORKBENCH_EDITOR_DRAWER_FOOTER_GROUP_STYLE}>
        <Button onClick={() => void onClose()}>
          {isReadonly ? '关闭' : '取消'}
        </Button>
        {!isReadonly ? (
          <Button
            type="primary"
            loading={loading}
            onClick={() => void onSubmit()}
          >
            {saveLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
