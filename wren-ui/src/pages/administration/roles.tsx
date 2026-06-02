import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import {
  Button,
  Form,
  Input,
  Modal,
  Table,
  TableColumnsType,
  Tag,
  Typography,
  message,
} from 'antd';
import IdcardOutlined from '@ant-design/icons/IdcardOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import SiderLayout from '@/components/layouts/SiderLayout';
import PageLayout from '@/components/layouts/PageLayout';
import {
  CREATE_ROLE,
  LIST_RBAC_ROLES,
  UPDATE_ROLE,
} from '@/apollo/client/graphql/rbac';
import { Role, User } from '@/components/pages/administration/types';
import { getAbsoluteTime } from '@/utils/time';

const { Paragraph, Text } = Typography;

type RoleModalState = {
  visible: boolean;
  role?: Role;
};

const RoleModal = ({
  state,
  loading,
  onClose,
  onSubmit,
}: {
  state: RoleModalState;
  loading: boolean;
  onClose: () => void;
  onSubmit: (values: any, role?: Role) => Promise<void>;
}) => {
  const [form] = Form.useForm();
  const isEdit = !!state.role;

  useEffect(() => {
    if (!state.visible) return;
    form.setFieldsValue({
      name: state.role?.name,
      description: state.role?.description,
    });
  }, [form, state.visible, state.role]);

  const submit = async () => {
    const values = await form.validateFields();
    await onSubmit(values, state.role);
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title={`${isEdit ? 'Edit' : 'Create'} role`}
      visible={state.visible}
      centered
      destroyOnClose
      maskClosable={false}
      confirmLoading={loading}
      onCancel={onClose}
      onOk={submit}
      okText={isEdit ? 'Save changes' : 'Create role'}
      afterClose={() => form.resetFields()}
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          label="Role name"
          name="name"
          rules={[
            {
              required: true,
              whitespace: true,
              message: 'Role name is required.',
            },
          ]}
        >
          <Input autoFocus placeholder="Security Auditor" maxLength={80} />
        </Form.Item>
        <Form.Item label="Description" name="description">
          <Input.TextArea
            placeholder="Describe the responsibility this role represents."
            rows={3}
            maxLength={500}
            showCount
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

const AssignedUsers = ({ users = [] }: { users?: User[] }) => {
  if (!users.length) return <span className="gray-6">No users assigned</span>;
  return (
    <>
      {users.map((user) => (
        <Tag key={user.id} className="mb-1">
          {user.name} - {user.email}
        </Tag>
      ))}
    </>
  );
};

export default function RoleManagement() {
  const [modalState, setModalState] = useState<RoleModalState>({
    visible: false,
  });
  const { data, loading, refetch } = useQuery(LIST_RBAC_ROLES, {
    fetchPolicy: 'cache-and-network',
  });
  const roles: Role[] = data?.roles || [];

  const mutationOptions = {
    onError: (error) => message.error(error.message),
  };
  const [createRole, createRoleState] = useMutation(
    CREATE_ROLE,
    mutationOptions,
  );
  const [updateRole, updateRoleState] = useMutation(
    UPDATE_ROLE,
    mutationOptions,
  );

  const closeModal = () => setModalState({ visible: false });

  const submitRole = async (values: any, role?: Role) => {
    if (role) {
      await updateRole({
        variables: {
          where: { id: role.id },
          data: {
            name: values.name,
            description: values.description || null,
          },
        },
      });
      message.success('Successfully updated role.');
    } else {
      await createRole({
        variables: {
          data: {
            name: values.name,
            description: values.description || null,
          },
        },
      });
      message.success('Successfully created role.');
    }
    await refetch();
  };

  const columns: TableColumnsType<Role> = [
    {
      title: 'Role',
      dataIndex: 'name',
      width: 220,
      render: (name) => <Text className="text-medium">{name}</Text>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      render: (description) => (
        <Paragraph ellipsis={{ rows: 2 }} className="mb-0">
          {description || <span className="gray-6">No description</span>}
        </Paragraph>
      ),
    },
    {
      title: 'Assigned users',
      dataIndex: 'users',
      render: (users) => <AssignedUsers users={users} />,
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
          onClick={() => setModalState({ visible: true, role: record })}
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
            <IdcardOutlined className="mr-2" />
            Role Management
          </>
        }
        description="Maintain reusable role definitions. Permission enforcement can be added later without changing these assignments."
        titleExtra={
          <Button
            type="primary"
            onClick={() => setModalState({ visible: true })}
          >
            Create role
          </Button>
        }
      >
        <Table
          className="ant-table-has-header"
          dataSource={roles}
          columns={columns}
          loading={loading}
          rowKey="id"
          pagination={{ pageSize: 10, hideOnSinglePage: true, size: 'small' }}
        />
        <RoleModal
          state={modalState}
          loading={createRoleState.loading || updateRoleState.loading}
          onClose={closeModal}
          onSubmit={submitRole}
        />
      </PageLayout>
    </SiderLayout>
  );
}
