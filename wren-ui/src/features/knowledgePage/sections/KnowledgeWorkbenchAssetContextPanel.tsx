import { Select } from 'antd';

import {
  LightButton,
  WorkbenchCompactItem,
  WorkbenchCompactItemMeta,
  WorkbenchCompactItemTitle,
  WorkbenchCompactList,
  WorkbenchCompactPanel,
  WorkbenchCompactPanelTitle,
  WorkbenchEditorActions,
  WorkbenchFilterChip,
  WorkbenchFilterRow,
} from '@/features/knowledgePage/index.styles';
import type { AssetView } from '@/features/knowledgePage/types';

type KnowledgeWorkbenchAssetContextAction = {
  label: string;
  onClick: () => void | Promise<void>;
};

type KnowledgeWorkbenchAssetContextPanelProps = {
  actions?: KnowledgeWorkbenchAssetContextAction[];
  asset?: AssetView | null;
  assetMeta: string;
  assetOptions: Array<{ label: string; value: string }>;
  placeholder: string;
  selectedAssetId?: string;
  onAssetChange: (value?: string) => void;
  onSuggestedQuestionClick: (question: string) => void;
};

export default function KnowledgeWorkbenchAssetContextPanel({
  actions = [],
  asset,
  assetMeta,
  assetOptions,
  placeholder,
  selectedAssetId,
  onAssetChange,
  onSuggestedQuestionClick,
}: KnowledgeWorkbenchAssetContextPanelProps) {
  const suggestedQuestions = (asset?.suggestedQuestions || []).slice(0, 3);

  return (
    <WorkbenchCompactPanel>
      <WorkbenchCompactPanelTitle>参考资产</WorkbenchCompactPanelTitle>
      <Select
        allowClear
        style={{ width: '100%' }}
        placeholder={placeholder}
        options={assetOptions}
        value={selectedAssetId}
        onChange={onAssetChange}
      />
      {asset ? (
        <>
          <WorkbenchCompactList style={{ marginTop: 10 }}>
            <WorkbenchCompactItem>
              <WorkbenchCompactItemTitle>
                {asset.name}
              </WorkbenchCompactItemTitle>
              <WorkbenchCompactItemMeta>{assetMeta}</WorkbenchCompactItemMeta>
            </WorkbenchCompactItem>
          </WorkbenchCompactList>
          {suggestedQuestions.length ? (
            <WorkbenchFilterRow style={{ marginTop: 10 }}>
              {suggestedQuestions.map((question) => (
                <WorkbenchFilterChip
                  key={question}
                  type="button"
                  onClick={() => onSuggestedQuestionClick(question)}
                >
                  {question}
                </WorkbenchFilterChip>
              ))}
            </WorkbenchFilterRow>
          ) : null}
          {actions.length ? (
            <WorkbenchEditorActions>
              {actions.map((action) => (
                <LightButton
                  key={action.label}
                  onClick={() => void action.onClick()}
                >
                  {action.label}
                </LightButton>
              ))}
            </WorkbenchEditorActions>
          ) : null}
        </>
      ) : null}
    </WorkbenchCompactPanel>
  );
}
