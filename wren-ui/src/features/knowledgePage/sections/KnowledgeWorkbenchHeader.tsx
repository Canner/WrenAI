import { EditOutlined } from '@ant-design/icons';
import {
  InfoRow,
  Pill,
  SummaryActions,
  SummaryCard,
  SummaryDescription,
  SummaryHeader,
  SummaryIconAction,
  SummaryInfo,
  SummaryTopRow,
  WorkbenchSectionTab,
  WorkbenchSectionTabs,
} from '@/features/knowledgePage/index.styles';
import type { KnowledgeWorkbenchSectionKey } from './knowledgeWorkbenchShared';

export const resolveKnowledgeWorkbenchModeLabel = ({
  isReadonlyKnowledgeBase,
  isSnapshotReadonlyKnowledgeBase,
}: {
  isReadonlyKnowledgeBase: boolean;
  isSnapshotReadonlyKnowledgeBase: boolean;
}) => {
  if (isReadonlyKnowledgeBase) {
    return '系统样例只读';
  }

  if (isSnapshotReadonlyKnowledgeBase) {
    return '历史快照只读';
  }

  return '可编辑';
};

const WORKBENCH_SECTIONS = [
  { key: 'overview', label: '概览' },
  { key: 'modeling', label: '建模' },
  { key: 'sqlTemplates', label: 'SQL 模板' },
  { key: 'instructions', label: '分析规则' },
] as const satisfies ReadonlyArray<{
  key: KnowledgeWorkbenchSectionKey;
  label: string;
}>;

export type KnowledgeWorkbenchHeaderProps = {
  activeWorkbenchSection: KnowledgeWorkbenchSectionKey;
  previewFieldCount: number;
  isSnapshotReadonlyKnowledgeBase: boolean;
  isReadonlyKnowledgeBase: boolean;
  isKnowledgeMutationDisabled: boolean;
  knowledgeMutationHint?: string | null;
  knowledgeDescription?: string | null;
  onOpenKnowledgeEditor: () => void;
  onChangeWorkbenchSection: (nextSection: KnowledgeWorkbenchSectionKey) => void;
};

export default function KnowledgeWorkbenchHeader({
  activeWorkbenchSection,
  previewFieldCount,
  isSnapshotReadonlyKnowledgeBase,
  isReadonlyKnowledgeBase,
  isKnowledgeMutationDisabled,
  knowledgeMutationHint,
  knowledgeDescription,
  onOpenKnowledgeEditor,
  onChangeWorkbenchSection,
}: KnowledgeWorkbenchHeaderProps) {
  const workbenchModeLabel = resolveKnowledgeWorkbenchModeLabel({
    isReadonlyKnowledgeBase,
    isSnapshotReadonlyKnowledgeBase,
  });

  return (
    <>
      <SummaryCard>
        <SummaryHeader>
          <SummaryTopRow>
            <InfoRow>
              <Pill>字段数：{previewFieldCount}/800</Pill>
              {isSnapshotReadonlyKnowledgeBase ? <Pill>历史快照</Pill> : null}
              {isReadonlyKnowledgeBase ? <Pill>系统样例</Pill> : null}
              <Pill>{workbenchModeLabel}</Pill>
            </InfoRow>

            <SummaryActions>
              {!isKnowledgeMutationDisabled ? (
                <SummaryIconAction
                  type="button"
                  onClick={onOpenKnowledgeEditor}
                  title="编辑知识库"
                  aria-label="编辑知识库"
                >
                  <EditOutlined />
                </SummaryIconAction>
              ) : null}
            </SummaryActions>
          </SummaryTopRow>

          <SummaryInfo>
            {knowledgeMutationHint ? (
              <SummaryDescription>{knowledgeMutationHint}</SummaryDescription>
            ) : null}
            {knowledgeDescription ? (
              <SummaryDescription>{knowledgeDescription}</SummaryDescription>
            ) : null}
          </SummaryInfo>
        </SummaryHeader>
      </SummaryCard>

      <WorkbenchSectionTabs>
        {WORKBENCH_SECTIONS.map((section) => (
          <WorkbenchSectionTab
            key={section.key}
            type="button"
            data-testid={`knowledge-workbench-tab-${section.key}`}
            $active={activeWorkbenchSection === section.key}
            onClick={() => void onChangeWorkbenchSection(section.key)}
          >
            {section.label}
          </WorkbenchSectionTab>
        ))}
      </WorkbenchSectionTabs>
    </>
  );
}
