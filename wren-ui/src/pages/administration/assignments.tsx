import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import {
  Button,
  Form,
  Modal,
  Popconfirm,
  Select,
  Table,
  TableColumnsType,
  Typography,
  message,
} from 'antd';
import SafetyCertificateOutlined from '@ant-design/icons/SafetyCertificateOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';
import SiderLayout from '@/components/layouts/SiderLayout';
import PageLayout from '@/components/layouts/PageLayout';
import {
  ASSIGN_ROLE_TO_USER,
  LIST_USER_ROLE_MAPPINGS,
  REMOVE_ROLE_FROM_USER,
  UPDATE_USER_ROLES,
} from '@/apollo/client/graphql/rbac';
import {
  Role,
  RoleTags,
  User,
  UserRoleMapping,
} from '@/components/pages/administration/types';
import { getAbsoluteTime } from '@/utils/time';

const { Text } = Typography;

type AssignmentModalState = {
  visible: boolean;
  user?: User;
};

const AssignmentModal = ({
  users,
  roles,
  state,
  loading,
  onClose,
  onSubmit,
}: {
  users: User[];
  roles: Role[];
  state: AssignmentModalState;
  loading: boolean;
  onClose: () => void;
  onSubmit: (values: any, user?: User) => Promise<void>;
}) => {
  const [form] = Form.useForm();
  const isUpdate = !!state.user;

  useEffect(() => {
    if (!state.visible) return;
    form.setFieldsValue({
      userId: state.user?.id,
      roleId: undefined,
      roleIds: state.user?.roles?.map((role) => role.id) || [],
    });
  }, [form, state.visible, state.user]);

  const submit = async () => {
    const values = await form.validateFields();
    await onSubmit(values, state.user);
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title={isUpdate ? 'Update user roles' : 'Assign role to user'}
      visible={state.visible}
      centered
      destroyOnClose
      maskClosable={false}
      confirmLoading={loading}
      onCancel={onClose}
      onOk={submit}
      okText={isUpdate ? 'Update assignment' : 'Assign role'}
      afterClose={() => form.resetFields()}
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          label="User"
          name="userId"
          rules={[{ required: true, message: 'Select a user.' }]}
        >
          <Select
            disabled={isUpdate}
            placeholder="Select user"
            options={users.map((user) => ({
              label: `${user.name} (${user.email})`,
              value: user.id,
            }))}
          />
        </Form.Item>
        {isUpdate ? (
          <Form.Item
            label="Roles"
            name="roleIds"
            rules={[{ required: true, message: 'Select at least one role.' }]}
          >
            <Select
              mode="multiple"
              placeholder="Select roles"
              options={roles.map((role) => ({
                label: role.name,
                value: role.id,
              }))}
            />
          </Form.Item>
        ) : (
          <Form.Item
            label="Role"
            name="roleId"
            rules={[{ required: true, message: 'Select a role.' }]}
          >
            <Select
              placeholder="Select role"
              options={roles.map((role) => ({
                label: role.name,
                value: role.id,
              }))}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
};

export default function UserRoleAssignment() {
  const [modalState, setModalState] = useState<AssignmentModalState>({
    visible: false,
  });
  const { data, loading, refetch } = useQuery(LIST_USER_ROLE_MAPPINGS, {
    fetchPolicy: 'cache-and-network',
  });
  const mappings: UserRoleMapping[] = data?.userRoleMappings || [];
  const users: User[] = data?.users || [];
  const roles: Role[] = data?.roles || [];

  const mutationOptions = {
    onError: (error) => message.error(error.message),
  };
  const [assignRole, assignRoleState] = useMutation(
    ASSIGN_ROLE_TO_USER,
    mutationOptions,
  );
  const [updateUserRoles, updateUserRolesState] = useMutation(
    UPDATE_USER_ROLES,
    mutationOptions,
  );
  const [removeRole, removeRoleState] = useMutation(
    REMOVE_ROLE_FROM_USER,
    mutationOptions,
  );

  const closeModal = () => setModalState({ visible: false });

  const submitAssignment = async (values: any, user?: User) => {
    if (user) {
      await updateUserRoles({
        variables: { data: { userId: user.id, roleIds: values.roleIds || [] } },
      });
      message.success('Successfully updated role assignment.');
    } else {
      await assignRole({
        variables: {
          data: { userId: values.userId, roleId: values.roleId },
        },
      });
      message.success('Successfully assigned role.');
    }
    await refetch();
  };

  const removeAssignment = async (mapping: UserRoleMapping) => {
    await removeRole({
      variables: { data: { userId: mapping.userId, roleId: mapping.roleId } },
    });
    message.success('Successfully removed role assignment.');
    await refetch();
  };

  const columns: TableColumnsType<UserRoleMapping> = [
    {
      title: 'User',
      dataIndex: 'user',
      render: (user: User) => (
        <div>
          <div className="text-medium">{user.name}</div>
          <Text className="gray-7">{user.email}</Text>
        </div>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'role',
      render: (role: Role) => <RoleTags roles={[role]} />,
    },
    {
      title: 'Assigned',
      dataIndex: 'createdAt',
      width: 180,
      render: (value) => (
        <span className="gray-7">{getAbsoluteTime(value)}</span>
      ),
    },
    {
      title: 'Actions',
      width: 220,
      align: 'center',
      render: (_, record) => (
        <>
          <Button
            type="text"
            size="small"
            onClick={() => setModalState({ visible: true, user: record.user })}
          >
            <EditOutlined /> Update user roles
          </Button>
          <Popconfirm
            title="Remove this role assignment?"
            okText="Remove"
            okButtonProps={{ danger: true }}
            onConfirm={() => removeAssignment(record)}
          >
            <Button type="text" size="small" danger>
              <DeleteOutlined /> Remove
            </Button>
          </Popconfirm>
        </>
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
        description="Assign roles to users and maintain role mappings for the RBAC foundation."
        titleExtra={
          <Button
            type="primary"
            onClick={() => setModalState({ visible: true })}
          >
            Assign role
          </Button>
        }
      >
        <Table
          className="ant-table-has-header"
          dataSource={mappings}
          columns={columns}
          loading={loading || removeRoleState.loading}
          rowKey="id"
          pagination={{ pageSize: 10, hideOnSinglePage: true, size: 'small' }}
        />
        <AssignmentModal
          users={users}
          roles={roles}
          state={modalState}
          loading={assignRoleState.loading || updateUserRolesState.loading}
          onClose={closeModal}
          onSubmit={submitAssignment}
        />
      </PageLayout>
    </SiderLayout>
  );
}
