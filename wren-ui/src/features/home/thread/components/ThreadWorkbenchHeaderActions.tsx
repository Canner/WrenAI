import { Button, Space, Tooltip } from 'antd';
import CopyOutlined from '@ant-design/icons/CopyOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import styled from 'styled-components';
import type { WorkbenchArtifactKind } from '@/features/home/thread/threadWorkbenchState';
import { useThreadWorkbenchMessages } from '@/features/home/thread/threadWorkbenchMessages';
import type { WorkbenchSqlController } from '@/features/home/thread/useWorkbenchSqlController';

const HeaderActionShell = styled.div`
  display: flex;
  align-items: center;

  .thread-workbench-action-btn {
    width: 30px;
    height: 30px;
    min-width: 30px;
    color: #4b5563;
    border-radius: 999px;
  }

  .thread-workbench-inline-btn {
    height: 30px;
    padding-inline: 10px;
    border-radius: 999px;
    font-weight: 500;
    color: #4b5563;
  }

  .thread-workbench-inline-btn.thread-workbench-primary-action {
    color: #6f47ff;
    background: rgba(111, 71, 255, 0.08);
  }
`;

export default function ThreadWorkbenchHeaderActions(props: {
  activeArtifact: WorkbenchArtifactKind;
  hasPreviewOwner?: boolean;
  onClose: () => void;
  onOpenSpreadsheet?: () => void;
  onPinDashboard?: () => void;
  sqlController: WorkbenchSqlController;
}) {
  const {
    activeArtifact,
    hasPreviewOwner = false,
    onClose,
    onOpenSpreadsheet,
    onPinDashboard,
    sqlController,
  } = props;
  const messages = useThreadWorkbenchMessages();
  const closeButton = (
    <Tooltip title={messages.close}>
      <Button
        aria-label={messages.close}
        className="thread-workbench-action-btn"
        icon={<CloseOutlined />}
        shape="circle"
        type="text"
        onClick={onClose}
      />
    </Tooltip>
  );
  const spreadsheetButton = hasPreviewOwner ? (
    <Button
      className="thread-workbench-inline-btn"
      size="small"
      type="text"
      onClick={onOpenSpreadsheet}
    >
      {messages.headerActions.spreadsheet}
    </Button>
  ) : null;
  const pinButton =
    activeArtifact === 'chart' && onPinDashboard ? (
      <Button
        className="thread-workbench-inline-btn thread-workbench-primary-action"
        size="small"
        type="text"
        onClick={onPinDashboard}
      >
        {messages.headerActions.pinDashboard}
      </Button>
    ) : null;

  if (activeArtifact === 'preview') {
    return (
      <HeaderActionShell>
        <Space size={8}>
          {spreadsheetButton}
          {closeButton}
        </Space>
      </HeaderActionShell>
    );
  }

  if (activeArtifact === 'sql') {
    return (
      <HeaderActionShell>
        <Space size={8}>
          <Tooltip title={messages.sql.copy}>
            <Button
              aria-label={messages.sql.copy}
              className="thread-workbench-action-btn"
              icon={<CopyOutlined />}
              shape="circle"
              type="text"
              onClick={() => void sqlController.onCopySql()}
            />
          </Tooltip>
          <Tooltip title={messages.sql.adjust}>
            <Button
              aria-label={messages.sql.adjust}
              className="thread-workbench-action-btn"
              icon={<EditOutlined />}
              shape="circle"
              type="text"
              onClick={sqlController.onOpenAdjustSqlModal}
            />
          </Tooltip>
          {closeButton}
        </Space>
      </HeaderActionShell>
    );
  }

  return (
    <HeaderActionShell>
      <Space size={8}>
        {spreadsheetButton}
        {pinButton}
        {closeButton}
      </Space>
    </HeaderActionShell>
  );
}
