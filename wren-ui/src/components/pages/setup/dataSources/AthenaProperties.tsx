import { Form, Input } from 'antd';
import { FORM_MODE } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';

interface Props {
  mode?: FORM_MODE;
}

export default function AthenaProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;
  return (
    <>
      <Form.Item
        label="Display name"
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
        label="Database (schema)"
        name="schema"
        extra="The Athena database (also called schema) that contains the tables you want to query."
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DATABASE.REQUIRED,
          },
        ]}
      >
        <Input disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label="S3 staging directory"
        name="s3StagingDir"
        required
        extra={
          <>
            The S3 path where Athena stores query results and metadata.
            <br />
            You can find this in the Athena console under{' '}
            <b>Settings {'>'} Query result location</b>.
          </>
        }
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.S3_STAGING_DIR.REQUIRED,
          },
        ]}
      >
        <Input placeholder="s3://bucket/path" />
      </Form.Item>
      <Form.Item
        label="AWS region"
        name="awsRegion"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.AWS_REGION.REQUIRED,
          },
        ]}
      >
        <Input placeholder="us-east-1" disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label="AWS access key ID"
        name="awsAccessKey"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.AWS_ACCESS_KEY.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>
      <Form.Item
        label="AWS secret access key"
        name="awsSecretKey"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.AWS_SECRET_KEY.REQUIRED,
          },
        ]}
      >
        <Input.Password />
      </Form.Item>
    </>
  );
}
