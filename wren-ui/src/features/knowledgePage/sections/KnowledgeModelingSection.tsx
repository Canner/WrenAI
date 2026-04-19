import ModelingWorkspace from '@/components/pages/modeling/ModelingWorkspace';
import {
  WorkbenchStatCard,
  WorkbenchStatLabel,
  WorkbenchStatsGrid,
  WorkbenchStatValue,
} from '@/features/knowledgePage/index.styles';
import type { KnowledgeWorkbenchModelingSummary } from '@/features/knowledgePage/sections/knowledgeWorkbenchShared';

export type KnowledgeModelingSectionProps = {
  modelingSummary?: KnowledgeWorkbenchModelingSummary;
  modelingWorkspaceKey: string;
  workbenchModeLabel: string;
};

export default function KnowledgeModelingSection({
  modelingSummary,
  modelingWorkspaceKey,
  workbenchModeLabel,
}: KnowledgeModelingSectionProps) {
  return (
    <>
      <WorkbenchStatsGrid>
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
        <WorkbenchStatCard>
          <WorkbenchStatLabel>关系</WorkbenchStatLabel>
          <WorkbenchStatValue>
            {modelingSummary?.relationCount || 0}
          </WorkbenchStatValue>
        </WorkbenchStatCard>
        <WorkbenchStatCard>
          <WorkbenchStatLabel>模式</WorkbenchStatLabel>
          <WorkbenchStatValue>{workbenchModeLabel}</WorkbenchStatValue>
        </WorkbenchStatCard>
      </WorkbenchStatsGrid>
      <ModelingWorkspace key={modelingWorkspaceKey} embedded />
    </>
  );
}
