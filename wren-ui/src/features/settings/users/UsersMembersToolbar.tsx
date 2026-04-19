import {
  Alert,
  Button,
  Col,
  Input,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import UserAddOutlined from '@ant-design/icons/UserAddOutlined';
import {
  ROLE_LABELS,
  STATUS_LABELS,
  applicationStatusColor,
} from './usersPageUtils';
import {
  ROLE_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
} from './usersMembersSectionTypes';

const { Text } = Typography;

export default function UsersMembersToolbar({
  canManageMembers,
  filteredCount,
  keyword,
  memberCount,
  reviewQueueCount,
  roleFilter,
  setInviteModalOpen,
  setKeyword,
  setRoleFilter,
  setStatusFilter,
  statusFilter,
  totalCount,
}: {
  canManageMembers: boolean;
  filteredCount: number;
  keyword: string;
  memberCount: number;
  reviewQueueCount: number;
  roleFilter: string;
  setInviteModalOpen: (open: boolean) => void;
  setKeyword: (value: string) => void;
  setRoleFilter: (value: 'all' | string) => void;
  setStatusFilter: (value: 'all' | string) => void;
  statusFilter: string;
  totalCount: number;
}) {
  return (
    <>
      <Row
        justify="space-between"
        gutter={[12, 12]}
        style={{ marginBottom: 16 }}
      >
        <Col flex="auto">
          <Space size={10} wrap>
            <Input.Search
              allowClear
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索姓名 / 账号 / 手机号"
              style={{ width: 300 }}
            />
            <Select
              value={roleFilter}
              options={ROLE_FILTER_OPTIONS}
              style={{ width: 140 }}
              onChange={(value) => setRoleFilter(value)}
            />
            <Select
              value={statusFilter}
              options={STATUS_FILTER_OPTIONS}
              style={{ width: 140 }}
              onChange={(value) => setStatusFilter(value)}
            />
            <Button
              onClick={() => {
                setKeyword('');
                setRoleFilter('all');
                setStatusFilter('all');
              }}
            >
              重置
            </Button>
          </Space>
        </Col>
        {canManageMembers ? (
          <Col>
            <Button
              type="primary"
              icon={<UserAddOutlined />}
              onClick={() => setInviteModalOpen(true)}
            >
              新增用户
            </Button>
          </Col>
        ) : null}
      </Row>

      {!canManageMembers ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="当前为只读视图"
          description="你可以查看用户信息与角色分布；编辑用户、调整角色与新增用户仍需要 workspace.member 管理权限。"
        />
      ) : null}

      <Space style={{ marginBottom: 12 }} wrap>
        <Text type="secondary">
          已显示 {filteredCount} / {totalCount} 名用户
        </Text>
        <Tag color="default">总用户 {memberCount}</Tag>
        <Tag color="default">待处理 {reviewQueueCount}</Tag>
        {roleFilter !== 'all' ? (
          <Tag color="blue">角色：{ROLE_LABELS[roleFilter] || roleFilter}</Tag>
        ) : null}
        {statusFilter !== 'all' ? (
          <Tag color={applicationStatusColor(statusFilter)}>
            状态：{STATUS_LABELS[statusFilter] || statusFilter}
          </Tag>
        ) : null}
      </Space>
    </>
  );
}
