import {
  Alert,
  Button,
  Card,
  Form,
  Row,
  Col,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import type {
  WorkspaceRoleBindingItem,
  WorkspaceRoleCatalogItem,
} from '@/features/settings/workspaceGovernanceShared';

type PrincipalType = 'user' | 'group' | 'service_account';

const PRINCIPAL_TYPE_LABELS: Record<PrincipalType, string> = {
  user: '用户',
  group: '目录组',
  service_account: '服务账号',
};

export default function PermissionsRoleBindingsSection({
  canReadRoles,
  canManageRoles,
  roleBindings,
  roleCatalog,
  roleCatalogLoading,
  bindingPrincipalType,
  bindingPrincipalId,
  bindingRoleId,
  principalOptions,
  bindingActionLoading,
  onBindingPrincipalTypeChange,
  onBindingPrincipalIdChange,
  onBindingRoleIdChange,
  onCreateRoleBinding,
  onDeleteRoleBinding,
}: {
  canReadRoles: boolean;
  canManageRoles: boolean;
  roleBindings: WorkspaceRoleBindingItem[];
  roleCatalog: WorkspaceRoleCatalogItem[];
  roleCatalogLoading: boolean;
  bindingPrincipalType: PrincipalType;
  bindingPrincipalId: string | null;
  bindingRoleId: string | null;
  principalOptions: Array<{ label: string; value: string }>;
  bindingActionLoading: {
    kind: 'create' | 'delete';
    bindingId?: string;
  } | null;
  onBindingPrincipalTypeChange: (value: PrincipalType) => void;
  onBindingPrincipalIdChange: (value: string | null) => void;
  onBindingRoleIdChange: (value: string | null) => void;
  onCreateRoleBinding: () => void;
  onDeleteRoleBinding: (bindingId: string) => void;
}) {
  return (
    <Card title="角色绑定">
      {!canReadRoles ? (
        <Alert
          type="info"
          showIcon
          title="当前为只读提示"
          description="你没有 role.read 权限，暂时无法查看角色绑定。"
        />
      ) : (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          {canManageRoles ? (
            <Form layout="vertical">
              <Row gutter={[12, 0]} align="bottom">
                <Col xs={24} md={8}>
                  <Form.Item label="主体类型">
                    <Select
                      value={bindingPrincipalType}
                      onChange={onBindingPrincipalTypeChange}
                      options={[
                        { label: '用户', value: 'user' },
                        { label: '目录组', value: 'group' },
                        { label: '服务账号', value: 'service_account' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item label="绑定主体">
                    <Select
                      allowClear
                      showSearch
                      value={bindingPrincipalId || undefined}
                      placeholder="选择主体"
                      optionFilterProp="label"
                      options={principalOptions}
                      onChange={(value) =>
                        onBindingPrincipalIdChange(value || null)
                      }
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item label="绑定角色">
                    <Select
                      allowClear
                      value={bindingRoleId || undefined}
                      placeholder="仅支持自定义角色"
                      options={roleCatalog
                        .filter((role) => !role.isSystem)
                        .map((role) => ({
                          label: role.displayName,
                          value: role.id,
                        }))}
                      onChange={(value) => onBindingRoleIdChange(value || null)}
                    />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Button
                    type="primary"
                    loading={bindingActionLoading?.kind === 'create'}
                    onClick={onCreateRoleBinding}
                  >
                    新建绑定
                  </Button>
                </Col>
              </Row>
            </Form>
          ) : (
            <Alert
              type="info"
              showIcon
              title="当前为只读视图"
              description="你可以查看角色绑定，但增删绑定需要 role.manage 权限。"
            />
          )}
          <Table
            className="console-table"
            rowKey="id"
            loading={roleCatalogLoading}
            pagination={{
              pageSize: 8,
              hideOnSinglePage: true,
            }}
            locale={{ emptyText: '暂无角色绑定数据' }}
            dataSource={roleBindings}
            columns={[
              {
                title: '主体类型',
                dataIndex: 'principalType',
                width: 110,
                render: (value: PrincipalType) => (
                  <Tag color="blue">
                    {PRINCIPAL_TYPE_LABELS[value] || value}
                  </Tag>
                ),
              },
              { title: '主体', dataIndex: 'principalLabel' },
              { title: '角色', dataIndex: 'roleDisplayName' },
              {
                title: '创建时间',
                dataIndex: 'createdAt',
                width: 140,
              },
              ...(canManageRoles
                ? [
                    {
                      title: '操作',
                      key: 'actions',
                      width: 90,
                      render: (
                        _value: unknown,
                        record: WorkspaceRoleBindingItem,
                      ) => (
                        <Button
                          danger
                          loading={
                            bindingActionLoading?.kind === 'delete' &&
                            bindingActionLoading.bindingId === record.id
                          }
                          onClick={() => onDeleteRoleBinding(record.id)}
                        >
                          删除
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Space>
      )}
    </Card>
  );
}
