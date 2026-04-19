import type { AssetView } from '@/features/knowledgePage/types';

import KnowledgeWorkbenchAssetContextPanel from './KnowledgeWorkbenchAssetContextPanel';

export type KnowledgeWorkbenchAssetContextEditorAction = {
  label: string;
  onClick: (asset: AssetView) => void | Promise<void>;
};

export type KnowledgeWorkbenchFormValueSetter = {
  setFieldsValue: (values: Record<string, unknown>) => void;
};

type KnowledgeWorkbenchAssetContextEditorPanelProps = {
  actions?: KnowledgeWorkbenchAssetContextEditorAction[];
  asset?: AssetView | null;
  assetMeta: string;
  assetOptions: Array<{ label: string; value: string }>;
  form: KnowledgeWorkbenchFormValueSetter;
  isReadonly: boolean;
  placeholder: string;
  questionField: string;
  selectedAssetId?: string;
  onAssetChange: (value?: string) => void;
};

export default function KnowledgeWorkbenchAssetContextEditorPanel({
  actions = [],
  asset,
  assetMeta,
  assetOptions,
  form,
  isReadonly,
  placeholder,
  questionField,
  selectedAssetId,
  onAssetChange,
}: KnowledgeWorkbenchAssetContextEditorPanelProps) {
  const resolvedActions =
    asset && !isReadonly
      ? actions.map((action) => ({
          label: action.label,
          onClick: () => action.onClick(asset),
        }))
      : [];

  return (
    <KnowledgeWorkbenchAssetContextPanel
      actions={resolvedActions}
      asset={asset}
      assetMeta={assetMeta}
      assetOptions={assetOptions}
      placeholder={placeholder}
      selectedAssetId={selectedAssetId}
      onAssetChange={onAssetChange}
      onSuggestedQuestionClick={(question) =>
        form.setFieldsValue({ [questionField]: question })
      }
    />
  );
}
