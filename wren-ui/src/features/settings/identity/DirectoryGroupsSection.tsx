import {
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  ROLE_OPTIONS,
  formatDirectoryGroupSource,
  type WorkspaceGovernanceOverview,
} from '@/features/settings/workspaceGovernanceShared';
import { renderSourceDetails } from '@/features/settings/workspaceGovernanceSharedUi';

const { Paragraph, Text } = Typography;

type DirectoryGroupRecord = NonNullable<
  WorkspaceGovernanceOverview['directoryGroups']
>[number];

export default function DirectoryGroupsSection({
  canManageIdentity,
  directoryGroups,
  groupLoading,
  groupMemberIds,
  groupName,
  groupRoleKey,
  loading,
  memberOptions,
  onCreate,
  onDelete,
  setGroupMemberIds,
  setGroupName,
  setGroupRoleKey,
}: {
  canManageIdentity: boolean;
  directoryGroups: DirectoryGroupRecord[];
  groupLoading: boolean;
  groupMemberIds: string[];
  groupName: string;
  groupRoleKey: string;
  loading: boolean;
  memberOptions: Array<{ label: string; value: string }>;
  onCreate: () => void;
  onDelete: (groupId: string) => void;
  setGroupMemberIds: (values: string[]) => void;
  setGroupName: (value: string) => void;
  setGroupRoleKey: (value: string) => void;
}) {
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={15}>
        <Card title="目录组">
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            目录组 {directoryGroups.length} 个，可作为 SCIM 之外的最小治理补充。
          </Text>
          <Table
            className="console-table"
            rowKey="id"
            loading={loading || groupLoading}
            pagination={false}
            locale={{ emptyText: '当前没有目录组' }}
            dataSource={directoryGroups}
            columns={[
              { title: '目录组', dataIndex: 'displayName' },
              {
                title: '角色',
                dataIndex: 'roleKeys',
                width: 120,
                render: (value: string[] | undefined) =>
                  (value || []).join('、') || 'member',
              },
              {
                title: '来源',
                dataIndex: 'source',
                width: 180,
                render: (
                  value: string | undefined,
                  record: DirectoryGroupRecord,
                ) => (
                  <Space size={[4, 4]} wrap>
                    <Tag color={value === 'scim' ? 'purple' : 'blue'}>
                      {formatDirectoryGroupSource(value)}
                    </Tag>
                    {renderSourceDetails(record.sourceDetails, '直接配置')}
                  </Space>
                ),
              },
              {
                title: '成员数',
                dataIndex: 'memberCount',
                width: 100,
                render: (value: number | undefined) => value || 0,
              },
              ...(canManageIdentity
                ? [
                    {
                      title: '操作',
                      key: 'actions',
                      width: 120,
                      render: (
                        _value: unknown,
                        record: DirectoryGroupRecord,
                      ) => (
                        <Button danger onClick={() => onDelete(record.id)}>
                          删除
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      </Col>
      <Col xs={24} xl={9}>
        <Card title="新建目录组">
          {canManageIdentity ? (
            <Form layout="vertical">
              <Form.Item label="目录组名称">
                <Input
                  placeholder="新目录组名称"
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                />
              </Form.Item>
              <Form.Item label="角色">
                <Select
                  value={groupRoleKey}
                  onChange={setGroupRoleKey}
                  options={ROLE_OPTIONS}
                />
              </Form.Item>
              <Form.Item label="成员">
                <Select
                  mode="multiple"
                  allowClear
                  value={groupMemberIds}
                  options={memberOptions}
                  onChange={setGroupMemberIds}
                  placeholder="可选：将当前成员加入目录组"
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Button loading={groupLoading} onClick={onCreate}>
                新建目录组
              </Button>
            </Form>
          ) : (
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              当前账号暂无 group.manage 权限，本页仅提供目录健康与绑定可见性。
            </Paragraph>
          )}
        </Card>
      </Col>
    </Row>
  );
}
