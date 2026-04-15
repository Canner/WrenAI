import { useEffect } from 'react';
import { Form, Input, Radio } from 'antd';
import { FORM_MODE, DATABRICKS_AUTH_METHOD } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import { hostValidator } from '@/utils/validator';

interface Props {
  mode?: FORM_MODE;
}

export default function DatabricksProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;

  const form = Form.useFormInstance();
  const databricksType = Form.useWatch(
    'databricksType',
    form,
  ) as DATABRICKS_AUTH_METHOD;

  useEffect(() => {
    if (!isEditMode) {
      form.setFieldsValue({
        databricksType: DATABRICKS_AUTH_METHOD.token,
      });
    }
  }, [isEditMode, form]);

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
      <Form.Item label="认证方式" name="databricksType">
        <Radio.Group buttonStyle="solid">
          <Radio.Button value={DATABRICKS_AUTH_METHOD.token}>
            个人访问令牌（PAT）
          </Radio.Button>
          <Radio.Button value={DATABRICKS_AUTH_METHOD.service_principal}>
            服务主体
          </Radio.Button>
        </Radio.Group>
      </Form.Item>
      <Form.Item
        label="服务器主机名"
        name="serverHostname"
        required
        rules={[
          {
            required: true,
            validator: hostValidator,
          },
        ]}
      >
        <Input
          placeholder="例如：adb-123456789.12.azuredatabricks.net"
          disabled={isEditMode}
        />
      </Form.Item>
      <Form.Item
        label="HTTP 路径"
        name="httpPath"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.HTTP_PATH.REQUIRED,
          },
        ]}
      >
        <Input
          placeholder="例如：/sql/1.0/endpoints/abc123"
          disabled={isEditMode}
        />
      </Form.Item>
      {databricksType === DATABRICKS_AUTH_METHOD.token && (
        <Form.Item
          label="访问令牌"
          name="accessToken"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.CONNECTION.PERSONAL_ACCESS_TOKEN.REQUIRED,
            },
          ]}
        >
          <Input.Password placeholder="请输入 Databricks 个人访问令牌" />
        </Form.Item>
      )}
      {databricksType === DATABRICKS_AUTH_METHOD.service_principal && (
        <>
          <Form.Item
            label="客户端 ID"
            name="clientId"
            required
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.CONNECTION.CLIENT_ID.REQUIRED,
              },
            ]}
          >
            <Input placeholder="请输入服务主体的 Client ID" />
          </Form.Item>
          <Form.Item
            label="客户端密钥"
            name="clientSecret"
            required
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.CONNECTION.CLIENT_SECRET.REQUIRED,
              },
            ]}
          >
            <Input.Password placeholder="请输入服务主体的 Client Secret" />
          </Form.Item>
          <Form.Item label="Azure 租户 ID" name="azureTenantId">
            <Input placeholder="例如：72f988bf-86f1-41af-91ab-2d7cd011db47" />
          </Form.Item>
        </>
      )}
    </>
  );
}
