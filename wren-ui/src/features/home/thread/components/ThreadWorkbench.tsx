import { Segmented, Typography } from 'antd';
import { useCallback, useMemo, useRef } from 'react';
import styled from 'styled-components';
import type { ThreadResponse } from '@/types/home';
import type { WorkbenchArtifactKind } from '@/features/home/thread/threadWorkbenchState';
import {
  resolveFallbackWorkbenchArtifact,
  resolveWorkbenchArtifactOwnerResponse,
  resolveResponseWorkbenchArtifacts,
} from '@/features/home/thread/threadWorkbenchState';
import { useThreadWorkbenchMessages } from '@/features/home/thread/threadWorkbenchMessages';
import { useWorkbenchSqlController } from '@/features/home/thread/useWorkbenchSqlController';
import ViewSQLTabContent from '@/components/pages/home/promptThread/ViewSQLTabContent';
import ChartAnswer from '@/components/pages/home/promptThread/ChartAnswer';
import ThreadWorkbenchPreviewPanel from './ThreadWorkbenchPreviewPanel';
import ThreadWorkbenchHeaderActions from './ThreadWorkbenchHeaderActions';

const WorkbenchShell = styled.aside`
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  border: 0;
  background: #fff;
  overflow: hidden;
  border-left: 1px solid rgba(15, 23, 42, 0.06);
`;

const WorkbenchHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px 4px;
  background: #fff;
`;

const WorkbenchHeaderMeta = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
`;

const WorkbenchQuestion = styled(Typography.Text)`
  && {
    display: block;
    margin-bottom: 0;
    color: #1f2937;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.45;
  }
`;

const WorkbenchSegmentedRow = styled.div`
  padding: 0 20px 12px;
  background: #fff;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);

  .ant-segmented {
    background: rgba(15, 23, 42, 0.04);
    padding: 3px;
    border-radius: 10px;
  }

  .ant-segmented-item {
    min-height: 32px;
    padding-inline: 14px;
    font-weight: 600;
  }

  .ant-segmented-item-selected {
    color: #6f47ff;
  }
`;

const WorkbenchBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: #fff;
`;

const WorkbenchContent = styled.div`
  height: 100%;
  min-height: 0;

  > * {
    height: 100%;
    min-height: 0;
  }
`;

const buildAnswerResultProps = (threadResponse: ThreadResponse) => ({
  motion: false,
  isLastThreadResponse: false,
  isOpeningQuestion: false,
  onInitPreviewDone: () => undefined,
  shouldAutoPreview: false,
  threadResponse,
});

export default function ThreadWorkbench(props: {
  activeArtifact?: WorkbenchArtifactKind | null;
  onArtifactChange: (artifact: WorkbenchArtifactKind) => void;
  onClose: () => void;
  responses: ThreadResponse[];
  selectedResponse: ThreadResponse;
}) {
  const messages = useThreadWorkbenchMessages();
  const workbenchRef = useRef<HTMLElement | null>(null);
  const {
    activeArtifact,
    onArtifactChange,
    onClose,
    responses,
    selectedResponse,
  } = props;
  const artifactItems = useMemo(
    () => resolveResponseWorkbenchArtifacts(selectedResponse),
    [selectedResponse],
  );
  const fallbackArtifact = useMemo(
    () => resolveFallbackWorkbenchArtifact(selectedResponse),
    [selectedResponse],
  );
  const activeKey = useMemo(
    () =>
      activeArtifact && artifactItems.includes(activeArtifact)
        ? activeArtifact
        : fallbackArtifact,
    [activeArtifact, artifactItems, fallbackArtifact],
  );
  const activeArtifactOwnerResponse = resolveWorkbenchArtifactOwnerResponse({
    artifact: activeKey,
    responses,
    selectedResponse,
  });
  const previewArtifactOwnerResponse = resolveWorkbenchArtifactOwnerResponse({
    artifact: 'preview',
    responses,
    selectedResponse,
  });
  const activeSqlController = useWorkbenchSqlController(
    activeArtifactOwnerResponse || selectedResponse,
  );
  const tabLabelMap: Record<WorkbenchArtifactKind, string> = messages.tabs;
  const handleOpenSpreadsheet = useCallback(() => {
    if (!artifactItems.includes('preview')) {
      return;
    }

    onArtifactChange('preview');
  }, [artifactItems, onArtifactChange]);
  const handlePinDashboard = useCallback(() => {
    const pinButton =
      Array.from(
        workbenchRef.current?.querySelectorAll<HTMLButtonElement>('button') ||
          [],
      ).find((button) => {
        const label =
          button.getAttribute('aria-label') || button.textContent?.trim();
        return (
          label === messages.headerActions.pinDashboard ||
          label === 'Pin to dashboard'
        );
      }) || null;
    pinButton?.click();
  }, [messages.headerActions.pinDashboard]);

  if (!activeKey) {
    return null;
  }

  const renderActiveArtifact = () => {
    const artifactOwnerResponse = resolveWorkbenchArtifactOwnerResponse({
      artifact: activeKey,
      responses,
      selectedResponse,
    });

    if (activeKey === 'preview') {
      return (
        <ThreadWorkbenchPreviewPanel response={artifactOwnerResponse || null} />
      );
    }

    if (activeKey === 'sql') {
      return (
        <ViewSQLTabContent
          {...buildAnswerResultProps(artifactOwnerResponse || selectedResponse)}
          mode="workbench"
          sqlController={activeSqlController}
        />
      );
    }

    return (
      <ChartAnswer
        {...buildAnswerResultProps(selectedResponse)}
        mode="workbench"
      />
    );
  };

  return (
    <WorkbenchShell data-testid="thread-workbench" ref={workbenchRef}>
      <WorkbenchHeader>
        <WorkbenchHeaderMeta>
          <WorkbenchQuestion ellipsis>
            {selectedResponse.question}
          </WorkbenchQuestion>
        </WorkbenchHeaderMeta>
        <ThreadWorkbenchHeaderActions
          activeArtifact={activeKey}
          hasPreviewOwner={Boolean(previewArtifactOwnerResponse)}
          onClose={onClose}
          onOpenSpreadsheet={handleOpenSpreadsheet}
          onPinDashboard={
            activeKey === 'chart' ? handlePinDashboard : undefined
          }
          sqlController={activeSqlController}
        />
      </WorkbenchHeader>
      <WorkbenchSegmentedRow>
        <Segmented
          value={activeKey}
          options={artifactItems.map((artifact) => ({
            label: tabLabelMap[artifact],
            value: artifact,
          }))}
          onChange={(value) => onArtifactChange(value as WorkbenchArtifactKind)}
        />
      </WorkbenchSegmentedRow>
      <WorkbenchBody>
        <WorkbenchContent>{renderActiveArtifact()}</WorkbenchContent>
      </WorkbenchBody>
    </WorkbenchShell>
  );
}
