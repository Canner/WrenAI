import {
  Button,
  Card,
  Checkbox,
  Dropdown,
  Empty,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import MoreOutlined from '@ant-design/icons/MoreOutlined';
import {
  ACTION_TAG_COLORS,
  COUNT_TAG_STYLE,
  getActionDescriptor,
  getPermissionDescription,
  getPermissionHeadline,
  type PermissionGroup,
} from './permissionsRoleCatalogMeta';

const { Paragraph, Text } = Typography;

type Props = {
  permissionGroups: PermissionGroup[];
  permissionReadOnly: boolean;
  roleCatalogLoading: boolean;
  selectedPermissionSet: Set<string>;
  onMutateGroupSelection: (
    permissionNames: string[],
    mode: 'select' | 'clear' | 'invert',
  ) => void;
  onTogglePermission: (permissionName: string, checked: boolean) => void;
};

export default function PermissionsRoleCatalogPermissionGroups({
  permissionGroups,
  permissionReadOnly,
  roleCatalogLoading,
  selectedPermissionSet,
  onMutateGroupSelection,
  onTogglePermission,
}: Props) {
  if (roleCatalogLoading) {
    return (
      <Space orientation="vertical" size={10} style={{ width: '100%' }}>
        <Card size="small">
          <Skeleton active paragraph={{ rows: 2 }} title={false} />
        </Card>
        <Card size="small">
          <Skeleton active paragraph={{ rows: 2 }} title={false} />
        </Card>
      </Space>
    );
  }

  if (permissionGroups.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="当前筛选下暂无权限"
      />
    );
  }

  return (
    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
      {permissionGroups.map((group) => {
        const selectedCount = group.items.filter((permission) =>
          selectedPermissionSet.has(permission.name),
        ).length;
        const assignablePermissionNames = group.items
          .filter((permission) => permission.assignable)
          .map((permission) => permission.name);
        return (
          <Card
            size="small"
            key={group.key}
            title={
              <Space size={8}>
                <Text strong>{group.label}</Text>
                <Tag style={COUNT_TAG_STYLE}>
                  {selectedCount}/{group.items.length}
                </Tag>
              </Space>
            }
            extra={
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    {
                      key: `${group.key}-select`,
                      label: '全选',
                      disabled:
                        permissionReadOnly ||
                        assignablePermissionNames.length === 0,
                      onClick: () =>
                        onMutateGroupSelection(
                          assignablePermissionNames,
                          'select',
                        ),
                    },
                    {
                      key: `${group.key}-clear`,
                      label: '清空',
                      disabled:
                        permissionReadOnly ||
                        assignablePermissionNames.length === 0,
                      onClick: () =>
                        onMutateGroupSelection(
                          assignablePermissionNames,
                          'clear',
                        ),
                    },
                    {
                      key: `${group.key}-invert`,
                      label: '反选',
                      disabled:
                        permissionReadOnly ||
                        assignablePermissionNames.length === 0,
                      onClick: () =>
                        onMutateGroupSelection(
                          assignablePermissionNames,
                          'invert',
                        ),
                    },
                  ],
                }}
              >
                <Button type="text" icon={<MoreOutlined />}>
                  更多
                </Button>
              </Dropdown>
            }
            styles={{ body: { padding: 8 } }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 8,
              }}
            >
              {group.items.map((permission) => {
                const checked = selectedPermissionSet.has(permission.name);
                const action = getActionDescriptor(permission.name);
                const permissionDescription =
                  getPermissionDescription(permission);
                const disabled = permissionReadOnly || !permission.assignable;
                return (
                  <label
                    key={permission.name}
                    style={{
                      minHeight: 80,
                      border: checked
                        ? '1px solid var(--ant-color-primary)'
                        : '1px solid var(--ant-color-border-secondary)',
                      borderRadius: 8,
                      padding: '6px 7px',
                      background: 'var(--ant-color-bg-container)',
                      cursor: disabled ? 'default' : 'pointer',
                      display: 'flex',
                      gap: 7,
                      alignItems: 'flex-start',
                      opacity: disabled && !checked ? 0.72 : 1,
                      boxShadow: checked
                        ? '0 0 0 1px rgba(22, 119, 255, 0.08) inset'
                        : 'none',
                    }}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onChange={(event) =>
                        onTogglePermission(
                          permission.name,
                          event.target.checked,
                        )
                      }
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Space size={[4, 4]} wrap>
                        <Tag color={ACTION_TAG_COLORS[action.key] || 'blue'}>
                          {action.label}
                        </Tag>
                        <Text strong style={{ maxWidth: 140 }} ellipsis>
                          {getPermissionHeadline(permission.name)}
                        </Text>
                        {!permission.assignable ? <Tag>系统保留</Tag> : null}
                      </Space>
                      <div style={{ marginTop: 6 }}>
                        <Text
                          type="secondary"
                          style={{
                            fontSize: 12,
                            maxWidth: 180,
                            lineHeight: 1.35,
                          }}
                          ellipsis={{ tooltip: permission.name }}
                        >
                          {permission.name}
                        </Text>
                      </div>
                      <Paragraph
                        type="secondary"
                        style={{
                          marginBottom: 0,
                          marginTop: 0,
                          fontSize: 12,
                          lineHeight: 1.35,
                        }}
                        ellipsis={{
                          rows: 1,
                          tooltip: permissionDescription,
                        }}
                      >
                        {permissionDescription}
                      </Paragraph>
                    </div>
                  </label>
                );
              })}
            </div>
          </Card>
        );
      })}
    </Space>
  );
}
