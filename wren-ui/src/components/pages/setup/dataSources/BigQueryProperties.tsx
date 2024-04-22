import { useEffect, useState } from 'react';
import { Form, Input, Button, Upload } from 'antd';
import UploadOutlined from '@ant-design/icons/UploadOutlined';
import { UploadFile } from 'antd/lib/upload/interface';
import { ERROR_TEXTS } from '@/utils/error';
import { FORM_MODE } from '@/utils/enum';

interface Props {
  mode?: FORM_MODE;
}

const UploadCredentials = (props) => {
  const { onChange, value } = props;

  const [fileList, setFileList] = useState<UploadFile[]>([]);

  useEffect(() => {
    if (!value) setFileList([]);
  }, [value]);

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

export default function BigQueryProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;

  return (
    <>
      <Form.Item
        label="Display name"
        required
        name="displayName"
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
            required: !isEditMode,
            message: ERROR_TEXTS.CONNECTION.PROJECT_ID.REQUIRED,
          },
        ]}
      >
        <Input placeholder="The GCP project ID" disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label="Dataset ID"
        required
        name="datasetId"
        rules={[
          {
            required: !isEditMode,
            message: ERROR_TEXTS.CONNECTION.DATASET_ID.REQUIRED,
          },
        ]}
      >
        <Input disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label="Credentials"
        required={!isEditMode}
        name="credentials"
        rules={[
          {
            required: !isEditMode,
            message: ERROR_TEXTS.CONNECTION.CREDENTIAL.REQUIRED,
          },
        ]}
      >
        <UploadCredentials />
      </Form.Item>
    </>
  );
}
