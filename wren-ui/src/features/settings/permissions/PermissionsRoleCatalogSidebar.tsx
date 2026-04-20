import {
  Badge,
  Button,
  Card,
  Dropdown,
  Empty,
  Input,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import MoreOutlined from '@ant-design/icons/MoreOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import type { WorkspaceRoleCatalogItem } from '@/features/settings/workspaceGovernanceShared';
import type { RoleMenuItem } from './permissionsRoleCatalogMeta';

const { Text } = Typography;

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
      styles={{
        body: {
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
        },
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <Text strong style={{ fontSize: 16 }}>
          角色列表
        </Text>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canManageRoles}
          onClick={onCreateRole}
        >
          新建
        </Button>
      </div>

      <Input.Search
        allowClear
        value={roleKeyword}
        placeholder="搜索角色"
        onChange={(event) => onRoleKeywordChange(event.target.value)}
        style={{ marginBottom: 8 }}
      />

      <div style={{ flex: 1, overflow: 'auto', paddingRight: 4 }}>
        {roleCatalogLoading ? (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
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
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            {visibleRoles.map((role) => {
              const selected = selectedRoleId === role.id && !isCreateMode;
              const deleting =
                roleActionLoading?.kind === 'delete' &&
                roleActionLoading.roleId === role.id;
              return (
                <div
                  key={role.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectRole(role.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectRole(role.id);
                    }
                  }}
                  style={{
                    border: selected
                      ? '1px solid var(--ant-color-primary-border)'
                      : '1px solid var(--ant-color-border-secondary)',
                    borderRadius: 8,
                    padding: '8px 8px 8px 10px',
                    cursor: 'pointer',
                    background: selected
                      ? 'rgba(22, 119, 255, 0.14)'
                      : 'var(--ant-color-bg-container)',
                    borderInlineStart: selected
                      ? '3px solid var(--ant-color-primary)'
                      : '3px solid transparent',
                    boxShadow: selected
                      ? '0 0 0 1px rgba(22, 119, 255, 0.14) inset'
                      : 'none',
                    transition: 'all 120ms ease',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Space size={4} wrap>
                        <Text strong ellipsis style={{ maxWidth: 150 }}>
                          {role.displayName || role.name}
                        </Text>
                        <Tag color={role.isSystem ? 'gold' : 'blue'}>
                          {role.isSystem ? '系统' : '自定义'}
                        </Tag>
                      </Space>
                      <div
                        style={{
                          marginTop: 2,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        <Space size={[8, 4]} wrap>
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
                      </div>
                    </div>
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
                  </div>
                </div>
              );
            })}
          </Space>
        )}
      </div>
    </Card>
  );
}
