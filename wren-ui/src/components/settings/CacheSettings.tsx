import { Button, Input, Form, Typography, Alert } from 'antd';
import Link from 'next/link';
import Image from 'next/image';
import { DATA_SOURCES } from '@/utils/enum';
import { getDataSource } from '@/components/pages/setup/utils';
import { ERROR_TEXTS } from '@/utils/error';

const CacheProperties = () => {
  const [form] = Form.useForm();

  const reset = () => {
    // TODO: reset form to original values
  };

  const submit = () => {
    form.validateFields().then((values) => {
      console.log(values);
    });
  };

  return (
    <Form form={form} layout="vertical">
      <div className="mb-6">
        <Typography.Text className="gray-8">
          You can cache the data models created in Modeling page at a Google
          Cloud Storage bucket. <Link href="">Learn more</Link> about how cache
          works.
        </Typography.Text>
      </div>

      <Form.Item
        required
        label="GCP Cloud storage bucket name"
        name="gcpBucketName"
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CACHE.GCP_BUCKET_NAME.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>
      <Form.Item
        required
        label="GCP access key"
        name="gcpAccessKey"
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CACHE.GCP_ACCESS_KEY.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>
      <Form.Item
        required
        label="GCP secret key"
        name="gcpSecretKey"
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CACHE.GCP_SECRET_KEY.REQUIRED,
          },
        ]}
      >
        <Input.Password />
      </Form.Item>

      <div className="py-2 text-right">
        <Button className="mr-2" style={{ width: 80 }} onClick={reset}>
          Cancel
        </Button>
        <Button type="primary" style={{ width: 80 }} onClick={submit}>
          Save
        </Button>
      </div>
    </Form>
  );
};

const supportedCacheDataSources = [DATA_SOURCES.BIG_QUERY];

export default function CacheSettings() {
  const type = DATA_SOURCES.BIG_QUERY;
  const current = getDataSource(type);

  return (
    <>
      <div className="d-flex align-center py-3 px-4">
        <Image
          className="mr-2"
          src={current.logo}
          alt={current.label}
          width="24"
          height="24"
        />
        {current.label}
      </div>
      <div className="py-3 px-4">
        {supportedCacheDataSources.includes(type) ? (
          <CacheProperties />
        ) : (
          <Alert
            type="info"
            showIcon
            message="Not Supported"
            description="Currently, we only support cache function with BigQuery."
          />
        )}
      </div>
    </>
  );
}
