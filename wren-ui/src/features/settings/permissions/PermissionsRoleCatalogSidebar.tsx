import {
  Badge,
  Button,
  Card,
  Col,
  Dropdown,
  Empty,
  Input,
  Row,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import MoreOutlined from '@ant-design/icons/MoreOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import type { WorkspaceRoleCatalogItem } from '@/features/settings/workspaceGovernanceShared';
import type { RoleMenuItem } from './permissionsRoleCatalogMeta';

const { Text, Title } = Typography;

const FULL_WIDTH_STYLE = {
  width: '100%',
} as const;

const SIDEBAR_BODY_STYLE = {
  padding: 8,
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
} as const;

const SIDEBAR_SCROLL_STYLE = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  paddingRight: 4,
} as const;

const ROLE_ITEM_BODY_STYLE = {
  padding: '8px 8px 8px 10px',
} as const;

const getRoleListItemStyle = (selected: boolean) =>
  ({
    width: '100%',
    border: selected
      ? '1px solid var(--ant-color-primary-border)'
      : '1px solid var(--ant-color-border-secondary)',
    borderRadius: 8,
    cursor: 'pointer',
    background: selected
      ? 'var(--ant-color-primary-bg)'
      : 'var(--ant-color-bg-container)',
    boxShadow: selected ? '0 0 0 1px rgba(22, 119, 255, 0.12) inset' : 'none',
    transition: 'all 120ms ease',
  }) as const;

type Props = {
  canManageRoles: boolean;
  isCreateMode: boolean;
  roleCatalogLoading: boolean;
  roleKeyword: string;
  roleActionLoading: {
    kind: 'create' | 'update' | 'delete';
    roleId?: string;
  } | null;
  selectedRoleId: string | null;
  visibleRoles: WorkspaceRoleCatalogItem[];
  onCreateRole: () => void;
  onRoleKeywordChange: (value: string) => void;
  onSelectRole: (roleId: string) => void;
  getRoleMenuItems: (role: WorkspaceRoleCatalogItem) => RoleMenuItem[];
};

export default function PermissionsRoleCatalogSidebar({
  canManageRoles,
  getRoleMenuItems,
  isCreateMode,
  onCreateRole,
  onRoleKeywordChange,
  onSelectRole,
  roleActionLoading,
  roleCatalogLoading,
  roleKeyword,
  selectedRoleId,
  visibleRoles,
}: Props) {
  return (
    <Card
      size="small"
      style={{ width: 286, flexShrink: 0 }}
      styles={{ body: SIDEBAR_BODY_STYLE }}
    >
      <Row
        align="middle"
        gutter={[8, 8]}
        justify="space-between"
        style={{ marginBottom: 12 }}
      >
        <Col flex="auto">
          <Title level={5} style={{ margin: 0 }}>
            角色列表
          </Title>
        </Col>
        <Col>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!canManageRoles}
            onClick={onCreateRole}
          >
            新建
          </Button>
        </Col>
      </Row>

      <Input.Search
        allowClear
        value={roleKeyword}
        placeholder="搜索角色"
        onChange={(event) => onRoleKeywordChange(event.target.value)}
        style={{ marginBottom: 8 }}
      />

      <Space orientation="vertical" size={0} style={SIDEBAR_SCROLL_STYLE}>
        {roleCatalogLoading ? (
          <Space orientation="vertical" size={8} style={FULL_WIDTH_STYLE}>
            <Card size="small">
              <Skeleton active title={false} paragraph={{ rows: 2 }} />
            </Card>
            <Card size="small">
              <Skeleton active title={false} paragraph={{ rows: 2 }} />
            </Card>
            <Card size="small">
              <Skeleton active title={false} paragraph={{ rows: 2 }} />
            </Card>
          </Space>
        ) : visibleRoles.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无匹配角色"
          />
        ) : (
          <Space orientation="vertical" size={6} style={FULL_WIDTH_STYLE}>
            {visibleRoles.map((role) => {
              const selected = selectedRoleId === role.id && !isCreateMode;
              const deleting =
                roleActionLoading?.kind === 'delete' &&
                roleActionLoading.roleId === role.id;
              return (
                <Card
                  key={role.id}
                  size="small"
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectRole(role.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectRole(role.id);
                    }
                  }}
                  style={getRoleListItemStyle(selected)}
                  styles={{ body: ROLE_ITEM_BODY_STYLE }}
                >
                  <Row align="top" gutter={[8, 8]} justify="space-between">
                    <Col flex="auto" style={{ minWidth: 0 }}>
                      <Space size={4} wrap>
                        <Text strong ellipsis style={{ maxWidth: 150 }}>
                          {role.displayName || role.name}
                        </Text>
                        <Tag color={role.isSystem ? 'gold' : 'blue'}>
                          {role.isSystem ? '系统' : '自定义'}
                        </Tag>
                      </Space>
                      <Space size={[8, 4]} wrap style={{ marginTop: 2 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {role.name}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          权限 {role.permissionNames.length}
                        </Text>
                        <Badge
                          status={
                            role.isActive === false ? 'default' : 'success'
                          }
                          text={role.isActive === false ? '停用' : '启用'}
                        />
                      </Space>
                    </Col>
                    <Col>
                      <Dropdown
                        trigger={['click']}
                        menu={{ items: getRoleMenuItems(role) }}
                      >
                        <Button
                          type="text"
                          icon={<MoreOutlined />}
                          loading={deleting}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </Dropdown>
                    </Col>
                  </Row>
                </Card>
              );
            })}
          </Space>
        )}
      </Space>
    </Card>
  );
}
