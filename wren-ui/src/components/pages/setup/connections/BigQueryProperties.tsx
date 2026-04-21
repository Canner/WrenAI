import { useEffect, useState } from 'react';
import { Form, Input, Button, Upload, UploadProps } from 'antd';
import UploadOutlined from '@ant-design/icons/UploadOutlined';
import { appMessage as message } from '@/utils/antdAppBridge';
import { ERROR_TEXTS } from '@/utils/error';
import { FORM_MODE } from '@/utils/enum';
import { readFileContent } from '@/utils/file';

interface Props {
  mode?: FORM_MODE;
}

const UploadCredentials = (props: {
  onChange?: (value?: Record<string, unknown>) => void;
  value?: Record<string, unknown>;
}) => {
  const { onChange, value } = props;

  const [fileList, setFileList] = useState<UploadProps['fileList']>([]);

  useEffect(() => {
    if (!value) setFileList([]);
  }, [value]);

  const onUploadChange: UploadProps['onChange'] = async (info) => {
    const { file, fileList } = info;
    if (fileList.length) {
      const uploadFile = fileList[0];
      if (!file.originFileObj) {
        message.error('文件读取失败，请重试。');
        return;
      }

      try {
        const result = await readFileContent(file.originFileObj);
        const parsedJson = JSON.parse(result);
        onChange?.(parsedJson as Record<string, unknown>);
        setFileList([uploadFile]);
      } catch {
        message.error('文件处理失败，请上传有效的凭证文件。');
      }
    }
  };

  const onRemove = () => {
    setFileList([]);
    onChange?.(undefined);
  };

  return (
    <Upload
      accept=".json"
      fileList={fileList}
      onChange={onUploadChange}
      onRemove={onRemove}
      maxCount={1}
    >
      <Button icon={<UploadOutlined />}>上传 JSON 密钥文件</Button>
    </Upload>
  );
};

export default function BigQueryProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;

  return (
    <>
      <Form.Item
        label="显示名称"
        required
        name="displayName"
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DISPLAY_NAME.REQUIRED,
          },
        ]}
      >
        <Input placeholder="例如：团队 BigQuery" />
      </Form.Item>
      <Form.Item
        label="项目 ID"
        required
        name="projectId"
        rules={[
          {
            required: !isEditMode,
            message: ERROR_TEXTS.CONNECTION.PROJECT_ID.REQUIRED,
          },
        ]}
      >
        <Input placeholder="请输入 GCP 项目 ID" disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label="数据集 ID"
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
        className="form-span-2"
        label="凭证"
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
