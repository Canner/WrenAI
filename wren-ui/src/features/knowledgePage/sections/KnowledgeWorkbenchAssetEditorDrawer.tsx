import type { ReactNode } from 'react';

import type { AssetView } from '@/features/knowledgePage/types';

import KnowledgeWorkbenchAssetContextEditorPanel, {
  type KnowledgeWorkbenchAssetContextEditorAction,
  type KnowledgeWorkbenchFormValueSetter,
} from './KnowledgeWorkbenchAssetContextEditorPanel';
import KnowledgeWorkbenchEditorDrawerShell from './KnowledgeWorkbenchEditorDrawerShell';

type KnowledgeWorkbenchAssetEditorDrawerProps = {
  actions?: KnowledgeWorkbenchAssetContextEditorAction[];
  asset?: AssetView | null;
  assetMeta: string;
  assetOptions: Array<{ label: string; value: string }>;
  children: ReactNode;
  form: KnowledgeWorkbenchFormValueSetter;
  isReadonly: boolean;
  loading: boolean;
  open: boolean;
  placeholder: string;
  questionField: string;
  saveLabel: string;
  selectedAssetId?: string;
  onAssetChange: (value?: string) => void;
  onClose: () => void | Promise<void>;
  onReset: () => void;
  onSubmit: () => void | Promise<void>;
};

export default function KnowledgeWorkbenchAssetEditorDrawer({
  actions,
  asset,
  assetMeta,
  assetOptions,
  children,
  form,
  isReadonly,
  loading,
  open,
  placeholder,
  questionField,
  saveLabel,
  selectedAssetId,
  onAssetChange,
  onClose,
  onReset,
  onSubmit,
}: KnowledgeWorkbenchAssetEditorDrawerProps) {
  return (
    <KnowledgeWorkbenchEditorDrawerShell
      isReadonly={isReadonly}
      loading={loading}
      open={open}
      saveLabel={saveLabel}
      onClose={onClose}
      onReset={onReset}
      onSubmit={onSubmit}
    >
      <KnowledgeWorkbenchAssetContextEditorPanel
        actions={actions}
        asset={asset}
        assetMeta={assetMeta}
        assetOptions={assetOptions}
        form={form}
        isReadonly={isReadonly}
        placeholder={placeholder}
        questionField={questionField}
        selectedAssetId={selectedAssetId}
        onAssetChange={onAssetChange}
      />
      {children}
    </KnowledgeWorkbenchEditorDrawerShell>
  );
}
