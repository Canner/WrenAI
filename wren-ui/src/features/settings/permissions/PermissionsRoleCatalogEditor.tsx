import {
  Button,
  Card,
  Col,
  Dropdown,
  Empty,
  Form,
  Input,
  Row,
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

const FULL_WIDTH_STYLE = {
  width: '100%',
} as const;

const EDITOR_BODY_STYLE = {
  padding: '8px 8px 4px',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
} as const;

const EDITOR_SECTION_STYLE = {
  width: '100%',
  borderBottom: '1px solid var(--ant-color-border-secondary)',
  paddingBottom: 8,
  marginBottom: 8,
} as const;

const EDITOR_STICKY_TABS_STYLE = {
  width: '100%',
  position: 'sticky' as const,
  top: 0,
  zIndex: 2,
  background: 'var(--ant-color-bg-container)',
  borderBottom: '1px solid var(--ant-color-border-secondary)',
  marginBottom: 8,
} as const;

const EDITOR_SCROLL_BODY_STYLE = {
  width: '100%',
  flex: 1,
  minHeight: 420,
  overflow: 'auto',
  paddingRight: 4,
  paddingBottom: 112,
} as const;

const EDITOR_FOOTER_STYLE = {
  width: '100%',
  marginTop: 'auto',
  borderTop: '1px solid var(--ant-color-border-secondary)',
  paddingTop: 8,
  paddingInline: 2,
  position: 'sticky' as const,
  bottom: 0,
  background: 'var(--ant-color-bg-container)',
  zIndex: 1,
} as const;

const EDITOR_FILTER_BAR_STYLE = {
  padding: '4px 8px',
  border: '1px solid var(--ant-color-border-secondary)',
  borderRadius: 8,
  background: 'var(--ant-color-fill-quaternary)',
} as const;

const EDITOR_METADATA_HINT_STYLE = {
  fontSize: 12,
} as const;

const EDITOR_DESCRIPTION_ITEM_STYLE = {
  marginBottom: 0,
  marginTop: 4,
} as const;

const ReadonlyField = ({
  fallback = '--',
  minWidth,
  value,
}: {
  fallback?: string;
  minWidth: number;
  value?: string | null;
}) => (
  <Input
    readOnly
    value={value?.trim() || fallback}
    style={{ width: minWidth }}
  />
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
      styles={{ body: EDITOR_BODY_STYLE }}
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
          <Space orientation="vertical" size={8} style={EDITOR_SECTION_STYLE}>
            <Row gutter={[12, 12]} align="middle" justify="space-between">
              <Col flex="auto" style={{ minWidth: 280 }}>
                <Form layout="vertical">
                  <Row gutter={[12, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item label="角色标识" style={{ marginBottom: 0 }}>
                        {metadataReadOnly && !isCreateMode ? (
                          <ReadonlyField value={draft.name} minWidth={188} />
                        ) : (
                          <Input
                            value={draft.name}
                            disabled={!canManageRoles || isSystemRole}
                            placeholder="例如：finance_admin"
                            onChange={(event) =>
                              onNameChange(
                                normalizeWorkspaceRoleNameInput(
                                  event.target.value,
                                ),
                              )
                            }
                          />
                        )}
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item label="角色名称" style={{ marginBottom: 0 }}>
                        {metadataReadOnly && !isCreateMode ? (
                          <ReadonlyField
                            value={draft.displayName || draft.name}
                            minWidth={208}
                          />
                        ) : (
                          <Input
                            value={draft.displayName}
                            disabled={metadataReadOnly}
                            placeholder="默认使用角色标识"
                            onChange={(event) =>
                              onDisplayNameChange(event.target.value)
                            }
                          />
                        )}
                      </Form.Item>
                    </Col>
                  </Row>
                </Form>
              </Col>

              <Col>
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
              </Col>
            </Row>

            <Space orientation="vertical" size={6} style={FULL_WIDTH_STYLE}>
              {isSystemRole ? (
                <Text type="secondary" style={EDITOR_METADATA_HINT_STYLE}>
                  系统角色仅允许修改权限，不允许修改角色标识、名称和启用状态。
                </Text>
              ) : (
                <Text type="secondary" style={EDITOR_METADATA_HINT_STYLE}>
                  自定义角色支持调整角色标识、名称、启用状态与权限配置。
                </Text>
              )}
              {!metadataReadOnly || isCreateMode ? (
                <Form layout="vertical">
                  <Form.Item
                    label="角色说明"
                    style={EDITOR_DESCRIPTION_ITEM_STYLE}
                  >
                    <Input
                      value={draft.description}
                      placeholder="角色说明（可选）"
                      disabled={metadataReadOnly}
                      onChange={(event) =>
                        onDescriptionChange(event.target.value)
                      }
                    />
                  </Form.Item>
                </Form>
              ) : null}
            </Space>
          </Space>

          <Space
            orientation="vertical"
            size={8}
            style={EDITOR_STICKY_TABS_STYLE}
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

            <Row
              gutter={[8, 8]}
              justify="space-between"
              style={EDITOR_FILTER_BAR_STYLE}
            >
              <Col flex="auto">
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
              </Col>

              <Col>
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
              </Col>
            </Row>
          </Space>

          <Space
            orientation="vertical"
            size={0}
            style={EDITOR_SCROLL_BODY_STYLE}
          >
            <PermissionsRoleCatalogPermissionGroups
              permissionGroups={permissionGroups}
              permissionReadOnly={permissionReadOnly}
              roleCatalogLoading={roleCatalogLoading}
              selectedPermissionSet={selectedPermissionSet}
              onMutateGroupSelection={onMutateGroupSelection}
              onTogglePermission={onTogglePermission}
            />
          </Space>

          <Space orientation="vertical" size={0} style={EDITOR_FOOTER_STYLE}>
            <Row align="middle" gutter={[12, 12]} justify="space-between">
              <Col flex="auto">
                <Space size={8} wrap>
                  <Text type={isDirty ? 'warning' : 'secondary'}>
                    {footerStatusText}
                  </Text>
                  {roleCatalogLoading ? (
                    <Tag color="default">同步中...</Tag>
                  ) : null}
                </Space>
              </Col>
              <Col>
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
                    {isCreateMode ? '新建角色' : '保存变更'}
                  </Button>
                </Space>
              </Col>
            </Row>
          </Space>
        </>
      )}
    </Card>
  );
}
