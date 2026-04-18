import { Form, Input } from 'antd';
import { ERROR_TEXTS } from '@/utils/error';
import { FORM_MODE } from '@/utils/enum';
import { hostValidator } from '@/utils/validator';

interface Props {
  mode?: FORM_MODE;
}

export default function OracleProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;
  return (
    <>
      <Form.Item
        label="显示名称"
        name="displayName"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DISPLAY_NAME.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>
      <Form.Item
        label="主机地址"
        name="host"
        rules={[
          {
            required: false,
            validator: (_, value) => {
              if (value) {
                return hostValidator(_, value);
              }
              return Promise.resolve();
            },
          },
        ]}
      >
        <Input placeholder="10.1.1.1" disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label="端口"
        name="port"
        rules={[
          {
            message: ERROR_TEXTS.CONNECTION.PORT.REQUIRED,
          },
        ]}
      >
        <Input placeholder="1521" disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label="用户名"
        name="user"
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.USERNAME.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>
      <Form.Item
        label="密码"
        name="password"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.PASSWORD.REQUIRED,
          },
        ]}
      >
        <Input.Password placeholder="请输入密码" />
      </Form.Item>
      <Form.Item
        label="数据库名称"
        name="database"
        rules={[
          {
            message: ERROR_TEXTS.CONNECTION.DATABASE.REQUIRED,
          },
        ]}
      >
        <Input placeholder="请输入 Oracle 数据库名称" disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        className="form-span-2"
        label="DSN"
        name="dsn"
        tooltip="Oracle 连接名称（DSN），可替代主机 / 端口 / 数据库配置。"
      >
        <Input placeholder="(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=host)(PORT=port))(CONNECT_DATA=(SERVICE_NAME=service)))" />
      </Form.Item>
    </>
  );
}
