import {
  Button,
  Card,
  Dropdown,
  Empty,
  Input,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import MoreOutlined from '@ant-design/icons/MoreOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import SaveOutlined from '@ant-design/icons/SaveOutlined';
import type { WorkspaceRoleCatalogItem } from '@/features/settings/workspaceGovernanceShared';
import PermissionsRoleCatalogPermissionGroups from './PermissionsRoleCatalogPermissionGroups';
import type {
  PermissionGroup,
  PermissionModuleKey,
  RoleDraft,
} from './permissionsRoleCatalogMeta';
import { normalizeWorkspaceRoleNameInput } from './permissionsPageUtils';

const { Text } = Typography;

const ReadonlyField = ({
  fallback = '--',
  minWidth,
  value,
}: {
  fallback?: string;
  minWidth: number;
  value?: string | null;
}) => (
  <div
    style={{
      height: 32,
      minWidth,
      display: 'flex',
      alignItems: 'center',
      paddingInline: 11,
      borderRadius: 6,
      border: '1px solid var(--ant-color-border)',
      background: 'var(--ant-color-bg-container-disabled)',
    }}
  >
    <Text ellipsis style={{ maxWidth: minWidth + 80 }}>
      {value?.trim() || fallback}
    </Text>
  </div>
);

type Props = {
  activeModuleKey: PermissionModuleKey;
  activeModulePermissionNames: string[];
  canManageRoles: boolean;
  draft: RoleDraft;
  footerStatusText: string;
  isCreateMode: boolean;
  isDirty: boolean;
  isSystemRole: boolean;
  metadataReadOnly: boolean;
  onlyShowSelected: boolean;
  permissionGroups: PermissionGroup[];
  permissionKeyword: string;
  permissionReadOnly: boolean;
  roleActionLoading: {
    kind: 'create' | 'update' | 'delete';
    roleId?: string;
  } | null;
  roleCatalogLoading: boolean;
  saveDisabled: boolean;
  selectedPermissionSet: Set<string>;
  selectedRole: WorkspaceRoleCatalogItem | null;
  tabsItems: Array<{ key: PermissionModuleKey; label: string }>;
  onActiveChange: (checked: boolean) => void;
  onActiveModuleChange: (key: PermissionModuleKey) => void;
  onClearFilters: () => void;
  onDescriptionChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onMutateGroupSelection: (
    permissionNames: string[],
    mode: 'select' | 'clear' | 'invert',
  ) => void;
  onMutateModuleSelection: (checked: boolean) => void;
  onNameChange: (value: string) => void;
  onOnlyShowSelectedChange: (checked: boolean) => void;
  onPermissionKeywordChange: (value: string) => void;
  onResetDraft: () => void;
  onSaveRole: () => void;
  onTogglePermission: (permissionName: string, checked: boolean) => void;
};

export default function PermissionsRoleCatalogEditor({
  activeModuleKey,
  activeModulePermissionNames,
  canManageRoles,
  draft,
  footerStatusText,
  isCreateMode,
  isDirty,
  isSystemRole,
  metadataReadOnly,
  onActiveChange,
  onActiveModuleChange,
  onClearFilters,
  onDescriptionChange,
  onDisplayNameChange,
  onMutateGroupSelection,
  onMutateModuleSelection,
  onNameChange,
  onOnlyShowSelectedChange,
  onPermissionKeywordChange,
  onResetDraft,
  onSaveRole,
  onTogglePermission,
  onlyShowSelected,
  permissionGroups,
  permissionKeyword,
  permissionReadOnly,
  roleActionLoading,
  roleCatalogLoading,
  saveDisabled,
  selectedPermissionSet,
  selectedRole,
  tabsItems,
}: Props) {
  const saveLoading =
    roleActionLoading?.kind === (isCreateMode ? 'create' : 'update') &&
    (isCreateMode || roleActionLoading.roleId === selectedRole?.id);

  return (
    <Card
      size="small"
      style={{ flex: 1, minWidth: 0 }}
      styles={{
        body: {
          padding: '8px 8px 4px',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          height: '100%',
        },
      }}
    >
      {!selectedRole && !isCreateMode ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            roleCatalogLoading ? '正在加载角色目录…' : '请选择左侧角色查看详情'
          }
        />
      ) : (
        <>
          <div
            style={{
              borderBottom: '1px solid var(--ant-color-border-secondary)',
              paddingBottom: 8,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  flexWrap: 'wrap',
                  flex: 1,
                  minWidth: 280,
                }}
              >
                <Space size={6} align="center" wrap>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    角色标识
                  </Text>
                  {metadataReadOnly && !isCreateMode ? (
                    <ReadonlyField value={draft.name} minWidth={188} />
                  ) : (
                    <Input
                      style={{ width: 188 }}
                      value={draft.name}
                      disabled={!canManageRoles || isSystemRole}
                      placeholder="例如：finance_admin"
                      onChange={(event) =>
                        onNameChange(
                          normalizeWorkspaceRoleNameInput(event.target.value),
                        )
                      }
                    />
                  )}
                </Space>
                <Space size={6} align="center" wrap>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    角色名称
                  </Text>
                  {metadataReadOnly && !isCreateMode ? (
                    <ReadonlyField
                      value={draft.displayName || draft.name}
                      minWidth={208}
                    />
                  ) : (
                    <Input
                      style={{ width: 208 }}
                      value={draft.displayName}
                      disabled={metadataReadOnly}
                      placeholder="默认使用角色标识"
                      onChange={(event) =>
                        onDisplayNameChange(event.target.value)
                      }
                    />
                  )}
                </Space>
              </div>

              <Space size={8} wrap>
                <Space size={8} align="center">
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    启用状态
                  </Text>
                  <Switch
                    checked={draft.isActive}
                    disabled={metadataReadOnly}
                    onChange={onActiveChange}
                  />
                </Space>
                <Button
                  icon={<ReloadOutlined />}
                  disabled={!isDirty}
                  onClick={onResetDraft}
                >
                  重置改动
                </Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  disabled={saveDisabled}
                  loading={saveLoading}
                  onClick={onSaveRole}
                >
                  {isCreateMode ? '新建角色' : '保存变更'}
                </Button>
              </Space>
            </div>

            <Space
              direction="vertical"
              size={6}
              style={{ width: '100%', marginTop: 10 }}
            >
              {isSystemRole ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  系统角色仅允许修改权限，不允许修改角色标识、名称和启用状态。
                </Text>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  自定义角色支持调整角色标识、名称、启用状态与权限配置。
                </Text>
              )}
              {!metadataReadOnly || isCreateMode ? (
                <Input
                  value={draft.description}
                  placeholder="角色说明（可选）"
                  disabled={metadataReadOnly}
                  onChange={(event) => onDescriptionChange(event.target.value)}
                />
              ) : null}
            </Space>
          </div>

          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 2,
              background: 'var(--ant-color-bg-container)',
              borderBottom: '1px solid var(--ant-color-border-secondary)',
              marginBottom: 8,
            }}
          >
            <Tabs
              size="small"
              activeKey={activeModuleKey}
              onChange={(key) =>
                onActiveModuleChange(key as PermissionModuleKey)
              }
              style={{ marginBottom: 0, paddingTop: 2 }}
              items={tabsItems}
            />

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                flexWrap: 'wrap',
                padding: '4px 8px',
                border: '1px solid var(--ant-color-border-secondary)',
                borderRadius: 8,
                background: 'var(--ant-color-fill-quaternary)',
              }}
            >
              <Space size={[10, 8]} wrap>
                <Input.Search
                  allowClear
                  value={permissionKeyword}
                  placeholder="搜索权限"
                  style={{ width: 220 }}
                  onChange={(event) =>
                    onPermissionKeywordChange(event.target.value)
                  }
                />
                <Space size={6}>
                  <Switch
                    size="small"
                    checked={onlyShowSelected}
                    onChange={onOnlyShowSelectedChange}
                  />
                  <Text type="secondary">仅看已选</Text>
                </Space>
              </Space>

              <Space size={8} wrap>
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      {
                        key: 'select-module',
                        label: '全选本模块',
                        disabled:
                          permissionReadOnly ||
                          activeModulePermissionNames.length === 0,
                        onClick: () => onMutateModuleSelection(true),
                      },
                      {
                        key: 'clear-module',
                        label: '清空本模块',
                        disabled:
                          permissionReadOnly ||
                          activeModulePermissionNames.length === 0,
                        onClick: () => onMutateModuleSelection(false),
                      },
                    ],
                  }}
                >
                  <Button
                    icon={<MoreOutlined />}
                    disabled={activeModulePermissionNames.length === 0}
                  >
                    模块操作
                  </Button>
                </Dropdown>
                <Button
                  disabled={!permissionKeyword && !onlyShowSelected}
                  onClick={onClearFilters}
                >
                  清空筛选
                </Button>
              </Space>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 420,
              overflow: 'auto',
              paddingRight: 4,
              paddingBottom: 112,
            }}
          >
            <PermissionsRoleCatalogPermissionGroups
              permissionGroups={permissionGroups}
              permissionReadOnly={permissionReadOnly}
              roleCatalogLoading={roleCatalogLoading}
              selectedPermissionSet={selectedPermissionSet}
              onMutateGroupSelection={onMutateGroupSelection}
              onTogglePermission={onTogglePermission}
            />
          </div>

          <div
            style={{
              marginTop: 'auto',
              borderTop: '1px solid var(--ant-color-border-secondary)',
              paddingTop: 8,
              paddingInline: 2,
              position: 'sticky',
              bottom: 0,
              background: 'var(--ant-color-bg-container)',
              zIndex: 1,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <Space size={8} wrap>
                <Text type={isDirty ? 'warning' : 'secondary'}>
                  {footerStatusText}
                </Text>
                {roleCatalogLoading ? (
                  <Tag color="default">同步中...</Tag>
                ) : null}
              </Space>
              <Space size={8}>
                <Button
                  icon={<ReloadOutlined />}
                  disabled={!isDirty}
                  onClick={onResetDraft}
                >
                  重置改动
                </Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  disabled={saveDisabled}
                  loading={saveLoading}
                  onClick={onSaveRole}
                >
                  保存变更
                </Button>
              </Space>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
