import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import {
  Button,
  Form,
  Modal,
  Select,
  Table,
  TableColumnsType,
  Typography,
  message,
} from 'antd';
import SafetyCertificateOutlined from '@ant-design/icons/SafetyCertificateOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import SiderLayout from '@/components/layouts/SiderLayout';
import PageLayout from '@/components/layouts/PageLayout';
import {
  LIST_USER_ROLE_MAPPINGS,
  UPDATE_MEMBER_ROLE,
} from '@/apollo/client/graphql/rbac';
import {
  OrganizationMember,
  Role,
  RoleTags,
} from '@/components/pages/administration/types';
import { getAbsoluteTime } from '@/utils/time';

const { Text } = Typography;

const AssignmentModal = ({
  member,
  roles,
  loading,
  onClose,
  onSubmit,
}: {
  member?: OrganizationMember;
  roles: Role[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (roleId: number, member: OrganizationMember) => Promise<void>;
}) => {
  const [form] = Form.useForm();

  useEffect(() => {
    if (!member) return;
    form.setFieldsValue({ roleId: member.roleId });
  }, [form, member]);

  const submit = async () => {
    if (!member) return;
    const values = await form.validateFields();
    await onSubmit(values.roleId, member);
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title="Update member role"
      visible={!!member}
      centered
      destroyOnClose
      confirmLoading={loading}
      onCancel={onClose}
      onOk={submit}
      okText="Update role"
      afterClose={() => form.resetFields()}
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item label="Member">
          <div>
            <div className="text-medium">{member?.user.name}</div>
            <Text className="gray-7">{member?.user.email}</Text>
          </div>
        </Form.Item>
        <Form.Item
          label="Role"
          name="roleId"
          rules={[{ required: true, message: 'Select a role.' }]}
        >
          <Select
            options={roles.map((role) => ({
              label: role.name,
              value: role.id,
            }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default function UserRoleAssignment() {
  const [editingMember, setEditingMember] = useState<OrganizationMember>();
  const { data, loading, refetch } = useQuery(LIST_USER_ROLE_MAPPINGS, {
    fetchPolicy: 'cache-and-network',
  });
  const members: OrganizationMember[] = data?.organizationMembers || [];
  const roles: Role[] = data?.roles || [];

  const [updateMemberRole, updateState] = useMutation(UPDATE_MEMBER_ROLE, {
    onError: (error) => message.error(error.message),
  });

  const submitAssignment = async (
    roleId: number,
    member: OrganizationMember,
  ) => {
    await updateMemberRole({
      variables: { data: { memberId: member.id, roleId } },
    });
    message.success('Role assignment updated.');
    await refetch();
  };

  const columns: TableColumnsType<OrganizationMember> = [
    {
      title: 'Member',
      dataIndex: 'user',
      render: (_, record) => (
        <div>
          <div className="text-medium">{record.user.name}</div>
          <Text className="gray-7">{record.user.email}</Text>
        </div>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'role',
      width: 180,
      render: (role: Role) => <RoleTags roles={[role]} />,
    },
    {
      title: 'Updated',
      dataIndex: 'updatedAt',
      width: 180,
      render: (value) => (
        <span className="gray-7">{getAbsoluteTime(value)}</span>
      ),
    },
    {
      title: 'Actions',
      width: 160,
      align: 'center',
      render: (_, record) => (
        <Button
          type="text"
          size="small"
          onClick={() => setEditingMember(record)}
        >
          <EditOutlined /> Update role
        </Button>
      ),
    },
  ];

  return (
    <SiderLayout loading={false}>
      <PageLayout
        title={
          <>
            <SafetyCertificateOutlined className="mr-2" />
            User Role Assignment
          </>
        }
        description="Assign each organization member to one foundation role."
      >
        <Table
          className="ant-table-has-header"
          dataSource={members}
          columns={columns}
          loading={loading}
          rowKey="id"
          pagination={{ pageSize: 10, hideOnSinglePage: true, size: 'small' }}
        />
        <AssignmentModal
          member={editingMember}
          roles={roles}
          loading={updateState.loading}
          onClose={() => setEditingMember(undefined)}
          onSubmit={submitAssignment}
        />
      </PageLayout>
    </SiderLayout>
  );
}
