import { Space, Typography } from 'antd';
import {
  AssetDetailQuestionList,
  LightButton,
  WorkbenchCompactPanel,
  WorkbenchCompactPanelTitle,
} from '@/features/knowledgePage/index.styles';
import type { AssetView } from '@/features/knowledgePage/types';

const { Text } = Typography;

type AssetDetailUsagePanelProps = {
  activeDetailAsset: AssetView;
  canCreateKnowledgeArtifacts: boolean;
  onCreateRuleDraft?: (asset: AssetView) => Promise<void> | void;
  onCreateSqlTemplateDraft?: (asset: AssetView) => Promise<void> | void;
};

export default function AssetDetailUsagePanel({
  activeDetailAsset,
  canCreateKnowledgeArtifacts,
  onCreateRuleDraft,
  onCreateSqlTemplateDraft,
}: AssetDetailUsagePanelProps) {
  return (
    <WorkbenchCompactPanel style={{ padding: '14px 16px' }}>
      <WorkbenchCompactPanelTitle style={{ marginBottom: 8 }}>
        推荐问法
      </WorkbenchCompactPanelTitle>
      {(activeDetailAsset.suggestedQuestions || []).length ? (
        <AssetDetailQuestionList>
          {(activeDetailAsset.suggestedQuestions || []).map((question) => (
            <li key={question}>{question}</li>
          ))}
        </AssetDetailQuestionList>
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>
          当前资产还没有推荐问法，可在后续问答中逐步沉淀。
        </Text>
      )}
      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid #eef2f7',
        }}
      >
        <Text
          strong
          style={{ display: 'block', marginBottom: 8, fontSize: 13 }}
        >
          使用建议
        </Text>
        <AssetDetailQuestionList style={{ marginBottom: 0 }}>
          <li>
            先确认主键、口径字段和时间字段是否完整，再开放给问答线程使用。
          </li>
          <li>
            如果这是视图，建议同时在 SQL
            模板页沉淀典型查询口径，提升问答稳定性。
          </li>
          <li>
            如果关联字段仍为空，可前往建模页补齐关系，减少跨主题问答歧义。
          </li>
        </AssetDetailQuestionList>
        {canCreateKnowledgeArtifacts ? (
          <Space size={8} wrap style={{ marginTop: 12 }}>
            <LightButton
              onClick={() => void onCreateSqlTemplateDraft?.(activeDetailAsset)}
            >
              新建 SQL 模板
            </LightButton>
            <LightButton
              onClick={() => void onCreateRuleDraft?.(activeDetailAsset)}
            >
              新建分析规则
            </LightButton>
          </Space>
        ) : null}
      </div>
    </WorkbenchCompactPanel>
  );
}
