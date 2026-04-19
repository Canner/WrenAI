import { Button, Input, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo } from 'react';
import { formatUserLabel } from '@/features/settings/workspaceGovernanceShared';
import { getReferenceDisplayWorkspaceName } from '@/utils/referenceDemoKnowledge';
import type {
  WorkspaceMemberView,
  WorkspaceListItem,
  WorkspaceOverviewPayload,
  WorkspacePageTab,
} from '../workspacePageTypes';
import {
  WORKSPACE_KIND_LABELS,
  workspaceKindColor,
} from '../workspacePageUtils';

const { Text } = Typography;

type Props = {
  activeTab: WorkspacePageTab;
  searchKeyword: string;
  onSearchKeywordChange: (value: string) => void;
  loading: boolean;
  defaultWorkspaceId: string | null;
  filteredWorkspaceCards: WorkspaceListItem[];
  filteredDiscoverableWorkspaces: WorkspaceListItem[];
  reviewQueue: WorkspaceMemberView[];
  workspace: WorkspaceOverviewPayload['workspace'] | null;
  canManageMembers: boolean;
  workspaceAction: {
    workspaceId: string;
    action: 'join' | 'apply';
  } | null;
  reviewAction: {
    memberId: string;
    action: 'approve' | 'reject';
  } | null;
  onSetDefaultWorkspace: (workspaceId: string) => Promise<void>;
  onWorkspaceAction: (
    workspaceId: string,
    action: 'join' | 'apply',
  ) => Promise<void>;
  onReviewAction: (
    memberId: string,
    action: 'approve' | 'reject',
  ) => Promise<void>;
};

export default function WorkspacePrimaryPanel({
  activeTab,
  searchKeyword,
  onSearchKeywordChange,
  loading,
  defaultWorkspaceId,
  filteredWorkspaceCards,
  filteredDiscoverableWorkspaces,
  reviewQueue,
  workspace,
  canManageMembers,
  workspaceAction,
  reviewAction,
  onSetDefaultWorkspace,
  onWorkspaceAction,
  onReviewAction,
}: Props) {
  const workspaceRows = useMemo(() => {
    const rowMap = new Map<
      string,
      {
        id: string;
        name: string;
        kind?: WorkspaceListItem['kind'];
        isDefault: boolean;
        source: 'member' | 'discover';
      }
    >();

    filteredWorkspaceCards.forEach((item) => {
      rowMap.set(item.id, {
        id: item.id,
        name: item.name,
        kind: item.kind,
        isDefault: item.id === defaultWorkspaceId,
        source: 'member',
      });
    });

    filteredDiscoverableWorkspaces.forEach((item) => {
      if (rowMap.has(item.id)) {
        return;
      }
      rowMap.set(item.id, {
        id: item.id,
        name: item.name,
        kind: item.kind,
        isDefault: false,
        source: 'discover',
      });
    });

    return Array.from(rowMap.values());
  }, [
    defaultWorkspaceId,
    filteredDiscoverableWorkspaces,
    filteredWorkspaceCards,
  ]);

  const reviewRows = useMemo(() => {
    const normalizedKeyword = searchKeyword.trim().toLowerCase();

    return reviewQueue
      .filter((item) => item.status === 'pending')
      .filter((item) => {
        if (!normalizedKeyword) {
          return true;
        }

        return [workspace?.name, item.user?.displayName, item.user?.email]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(normalizedKeyword);
      });
  }, [reviewQueue, searchKeyword, workspace?.name]);

  const workspaceColumns: ColumnsType<(typeof workspaceRows)[number]> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (value: string) => (
        <Space size={8}>
          <Text strong>{getReferenceDisplayWorkspaceName(value)}</Text>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'kind',
      key: 'kind',
      width: 140,
      render: (value?: string | null) => (
        <Tag color={workspaceKindColor(value)}>
          {WORKSPACE_KIND_LABELS[value || 'regular']}
        </Tag>
      ),
    },
    {
      title: '是否默认',
      dataIndex: 'isDefault',
      key: 'isDefault',
      width: 120,
      render: (value: boolean) =>
        value ? <Tag color="gold">是</Tag> : <Text type="secondary">否</Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, record) =>
        record.source === 'member' ? (
          record.isDefault ? (
            <Text type="secondary">已默认</Text>
          ) : (
            <Button onClick={() => void onSetDefaultWorkspace(record.id)}>
              设为默认
            </Button>
          )
        ) : (
          <Button
            type="primary"
            loading={
              workspaceAction?.workspaceId === record.id &&
              workspaceAction.action === 'apply'
            }
            onClick={() => void onWorkspaceAction(record.id, 'apply')}
          >
            申请加入
          </Button>
        ),
    },
  ];

  const reviewColumns: ColumnsType<WorkspaceMemberView> = [
    {
      title: '名称',
      key: 'workspaceName',
      render: () => (
        <Space size={8}>
          <Text strong>
            {getReferenceDisplayWorkspaceName(workspace?.name || '—')}
          </Text>
        </Space>
      ),
    },
    {
      title: '类型',
      key: 'workspaceKind',
      width: 140,
      render: () => (
        <Tag color={workspaceKindColor(workspace?.kind)}>
          {WORKSPACE_KIND_LABELS[workspace?.kind || 'regular']}
        </Tag>
      ),
    },
    {
      title: '申请人',
      key: 'applicant',
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text>
            {formatUserLabel(
              record.user?.displayName,
              record.user?.email,
              record.userId,
            )}
          </Text>
          {record.user?.email && record.user?.displayName ? (
            <Text type="secondary">{record.user.email}</Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_, record) =>
        canManageMembers ? (
          <Space size={8}>
            <Button
              type="primary"
              loading={
                reviewAction?.memberId === record.id &&
                reviewAction.action === 'approve'
              }
              onClick={() => void onReviewAction(record.id, 'approve')}
            >
              批准
            </Button>
            <Button
              danger
              loading={
                reviewAction?.memberId === record.id &&
                reviewAction.action === 'reject'
              }
              onClick={() => void onReviewAction(record.id, 'reject')}
            >
              拒绝
            </Button>
          </Space>
        ) : (
          <Text type="secondary">无审批权限</Text>
        ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Input.Search
        allowClear
        value={searchKeyword}
        onChange={(event) => onSearchKeywordChange(event.target.value)}
        placeholder={
          activeTab === 'applications'
            ? '搜索工作空间 / 申请人'
            : '搜索工作空间名称'
        }
      />

      {activeTab === 'applications' ? (
        <Table
          className="console-table"
          dataSource={reviewRows}
          loading={loading}
          columns={reviewColumns}
          rowKey="id"
          pagination={false}
          locale={{
            emptyText: loading ? '加载中…' : '暂无待审批申请',
          }}
          scroll={{ x: 980 }}
        />
      ) : (
        <Table
          className="console-table"
          dataSource={workspaceRows}
          loading={loading}
          columns={workspaceColumns}
          rowKey="id"
          pagination={false}
          locale={{
            emptyText: loading ? '加载中…' : '暂无可展示的工作空间',
          }}
          scroll={{ x: 920 }}
        />
      )}
    </Space>
  );
}
