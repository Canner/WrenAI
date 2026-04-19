import { memo } from 'react';
import {
  WorkbenchStatCard,
  WorkbenchStatLabel,
  WorkbenchStatsGrid,
  WorkbenchStatValue,
} from '@/features/knowledgePage/index.styles';
import type { KnowledgeWorkbenchModelingSummary } from './knowledgeWorkbenchShared';

type KnowledgeOverviewStatsProps = {
  previewFieldCount: number;
  detailAssetsCount: number;
  sqlListCount: number;
  ruleListCount: number;
  modelingSummary?: KnowledgeWorkbenchModelingSummary;
};

function KnowledgeOverviewStats({
  previewFieldCount,
  detailAssetsCount,
  sqlListCount,
  ruleListCount,
  modelingSummary,
}: KnowledgeOverviewStatsProps) {
  return (
    <WorkbenchStatsGrid>
      <WorkbenchStatCard>
        <WorkbenchStatLabel>资产数</WorkbenchStatLabel>
        <WorkbenchStatValue>{detailAssetsCount}</WorkbenchStatValue>
      </WorkbenchStatCard>
      <WorkbenchStatCard>
        <WorkbenchStatLabel>字段预算</WorkbenchStatLabel>
        <WorkbenchStatValue>{previewFieldCount}/800</WorkbenchStatValue>
      </WorkbenchStatCard>
      <WorkbenchStatCard>
        <WorkbenchStatLabel>SQL 模板</WorkbenchStatLabel>
        <WorkbenchStatValue>{sqlListCount}</WorkbenchStatValue>
      </WorkbenchStatCard>
      <WorkbenchStatCard>
        <WorkbenchStatLabel>分析规则</WorkbenchStatLabel>
        <WorkbenchStatValue>{ruleListCount}</WorkbenchStatValue>
      </WorkbenchStatCard>
      <WorkbenchStatCard>
        <WorkbenchStatLabel>模型</WorkbenchStatLabel>
        <WorkbenchStatValue>
          {modelingSummary?.modelCount || 0}
        </WorkbenchStatValue>
      </WorkbenchStatCard>
      <WorkbenchStatCard>
        <WorkbenchStatLabel>视图</WorkbenchStatLabel>
        <WorkbenchStatValue>
          {modelingSummary?.viewCount || 0}
        </WorkbenchStatValue>
      </WorkbenchStatCard>
    </WorkbenchStatsGrid>
  );
}

export default memo(KnowledgeOverviewStats);
