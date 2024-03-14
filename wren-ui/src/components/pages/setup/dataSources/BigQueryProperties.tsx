import { useState } from 'react';
import { Form, Input, Button, Upload } from 'antd';
import UploadOutlined from '@ant-design/icons/UploadOutlined';
import { UploadFile } from 'antd/lib/upload/interface';
import { ERROR_TEXTS } from '@/utils/error';

const UploadCredentials = (props) => {
  const { onChange } = props;

  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const convertFileToJSON = (file: any, callback: (value: JSON) => void) => {
    const reader = new FileReader();
    reader.onloadend = (_e) => {
      const result = reader.result;

      if (result) {
        const fileContent: JSON = JSON.parse(String(result));
        callback(fileContent);
      }
    };

    reader.readAsText(file);
  };

  const onUploadChange = (info) => {
    const { file, fileList } = info;
    if (fileList.length) {
      const uploadFile = fileList[0];
      convertFileToJSON(file.originFileObj, (fileContent: JSON) => {
        onChange && onChange(fileContent);
      });
      setFileList([uploadFile]);
    }
  };

  const onRemove = () => {
    setFileList([]);
    onChange && onChange(undefined);
  };

  return (
    <Upload
      accept=".json"
      fileList={fileList}
      onChange={onUploadChange}
      onRemove={onRemove}
      maxCount={1}
    >
      <Button icon={<UploadOutlined />}>Click to upload JSON key file</Button>
    </Upload>
  );
};

export default function BigQueryProperties() {
  return (
    <>
      <Form.Item
        label="Display name"
        required
        name="displayName"
        extra="The name will be called in VulcanSQL."
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DISPLAY_NAME.REQUIRED,
          },
        ]}
      >
        <Input placeholder="Our BigQuery" />
      </Form.Item>
      <Form.Item
        label="Project ID"
        required
        name="projectId"
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.PROJECT_ID.REQUIRED,
          },
        ]}
      >
        <Input placeholder="The GCP project ID" />
      </Form.Item>
      <Form.Item
        label="Dataset name"
        required
        name="dataset"
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DATASET.REQUIRED,
          },
        ]}
      >
        <Input placeholder="The dataset name" />
      </Form.Item>
      <Form.Item
        label="Data Location"
        required
        name="location"
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.LOCATION.REQUIRED,
          },
        ]}
      >
        <Input placeholder="The location of the dataset. e.g. US." />
      </Form.Item>
      <Form.Item
        label="Credentials"
        required
        name="credentials"
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.CREDENTIAL.REQUIRED,
          },
        ]}
      >
        <UploadCredentials />
      </Form.Item>
    </>
  );
}
