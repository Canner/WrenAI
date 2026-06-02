import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Table,
  TableColumnsType,
  Typography,
  message,
} from 'antd';
import TeamOutlined from '@ant-design/icons/TeamOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import SiderLayout from '@/components/layouts/SiderLayout';
import PageLayout from '@/components/layouts/PageLayout';
import {
  CREATE_USER,
  LIST_RBAC_USERS,
  UPDATE_USER,
  UPDATE_USER_ROLES,
} from '@/apollo/client/graphql/rbac';
import {
  Role,
  RoleTags,
  StatusTag,
  User,
} from '@/components/pages/administration/types';
import { getAbsoluteTime } from '@/utils/time';

const { Text } = Typography;

type UserModalState = {
  visible: boolean;
  user?: User;
};

const UserModal = ({
  roles,
  state,
  loading,
  onClose,
  onSubmit,
}: {
  roles: Role[];
  state: UserModalState;
  loading: boolean;
  onClose: () => void;
  onSubmit: (values: any, user?: User) => Promise<void>;
}) => {
  const [form] = Form.useForm();
  const isEdit = !!state.user;

  useEffect(() => {
    if (!state.visible) return;
    form.setFieldsValue({
      name: state.user?.name,
      email: state.user?.email,
      externalId: state.user?.externalId,
      identityProvider: state.user?.identityProvider,
      isActive: state.user?.isActive ?? true,
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
      title={`${isEdit ? 'Edit' : 'Create'} user`}
      visible={state.visible}
      centered
      destroyOnClose
      maskClosable={false}
      confirmLoading={loading}
      onCancel={onClose}
      onOk={submit}
      okText={isEdit ? 'Save changes' : 'Create user'}
      afterClose={() => form.resetFields()}
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          label="Name"
          name="name"
          rules={[
            { required: true, whitespace: true, message: 'Name is required.' },
          ]}
        >
          <Input autoFocus placeholder="Jane Doe" maxLength={160} />
        </Form.Item>
        <Form.Item
          label="Email"
          name="email"
          rules={[
            { required: true, message: 'Email is required.' },
            { type: 'email', message: 'Enter a valid email address.' },
          ]}
        >
          <Input placeholder="jane@example.com" maxLength={320} />
        </Form.Item>
        <Form.Item label="Assigned roles" name="roleIds">
          <Select
            mode="multiple"
            placeholder="Select roles"
            options={roles.map((role) => ({
              label: role.name,
              value: role.id,
            }))}
          />
        </Form.Item>
        <Form.Item label="External ID" name="externalId">
          <Input placeholder="Optional LDAP or Azure AD object ID" />
        </Form.Item>
        <Form.Item label="Identity provider" name="identityProvider">
          <Input placeholder="Optional provider name, e.g. ldap or azure_ad" />
        </Form.Item>
        <Form.Item
          label="Active"
          name="isActive"
          valuePropName="checked"
          initialValue
        >
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default function UserManagement() {
  const [modalState, setModalState] = useState<UserModalState>({
    visible: false,
  });
  const { data, loading, refetch } = useQuery(LIST_RBAC_USERS, {
    fetchPolicy: 'cache-and-network',
  });
  const users: User[] = data?.users || [];
  const roles: Role[] = data?.roles || [];

  const mutationOptions = {
    onError: (error) => message.error(error.message),
  };
  const [createUser, createUserState] = useMutation(
    CREATE_USER,
    mutationOptions,
  );
  const [updateUser, updateUserState] = useMutation(
    UPDATE_USER,
    mutationOptions,
  );
  const [updateUserRoles, updateRolesState] = useMutation(
    UPDATE_USER_ROLES,
    mutationOptions,
  );

  const closeModal = () => setModalState({ visible: false });

  const submitUser = async (values: any, user?: User) => {
    if (user) {
      await updateUser({
        variables: {
          where: { id: user.id },
          data: {
            name: values.name,
            email: values.email,
            externalId: values.externalId || null,
            identityProvider: values.identityProvider || null,
            isActive: values.isActive,
          },
        },
      });
      await updateUserRoles({
        variables: {
          data: { userId: user.id, roleIds: values.roleIds || [] },
        },
      });
      message.success('Successfully updated user.');
    } else {
      await createUser({
        variables: {
          data: {
            name: values.name,
            email: values.email,
            externalId: values.externalId || null,
            identityProvider: values.identityProvider || null,
            isActive: values.isActive,
            roleIds: values.roleIds || [],
          },
        },
      });
      message.success('Successfully created user.');
    }
    await refetch();
  };

  const columns: TableColumnsType<User> = [
    {
      title: 'User',
      dataIndex: 'name',
      render: (_, record) => (
        <div>
          <div className="text-medium">{record.name}</div>
          <Text className="gray-7">{record.email}</Text>
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      width: 120,
      render: (active) => <StatusTag active={active} />,
    },
    {
      title: 'Assigned roles',
      dataIndex: 'roles',
      render: (assignedRoles) => <RoleTags roles={assignedRoles} />,
    },
    {
      title: 'Identity provider',
      dataIndex: 'identityProvider',
      width: 180,
      render: (value) => value || <span className="gray-6">Local</span>,
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      width: 180,
      render: (value) => (
        <span className="gray-7">{getAbsoluteTime(value)}</span>
      ),
    },
    {
      title: 'Actions',
      width: 110,
      align: 'center',
      render: (_, record) => (
        <Button
          type="text"
          size="small"
          onClick={() => setModalState({ visible: true, user: record })}
        >
          <EditOutlined /> Edit
        </Button>
      ),
    },
  ];

  return (
    <SiderLayout loading={false}>
      <PageLayout
        title={
          <>
            <TeamOutlined className="mr-2" />
            User Management
          </>
        }
        description="Create users, maintain local identity metadata, and review assigned foundation roles."
        titleExtra={
          <Button
            type="primary"
            onClick={() => setModalState({ visible: true })}
          >
            Create user
          </Button>
        }
      >
        <Table
          className="ant-table-has-header"
          dataSource={users}
          columns={columns}
          loading={loading}
          rowKey="id"
          pagination={{ pageSize: 10, hideOnSinglePage: true, size: 'small' }}
        />
        <UserModal
          roles={roles}
          state={modalState}
          loading={
            createUserState.loading ||
            updateUserState.loading ||
            updateRolesState.loading
          }
          onClose={closeModal}
          onSubmit={submitUser}
        />
      </PageLayout>
    </SiderLayout>
  );
}
