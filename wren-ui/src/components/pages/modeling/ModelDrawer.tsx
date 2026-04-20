import { Button, Drawer, Form, Space } from 'antd';
import { FORM_MODE } from '@/utils/enum';
import { handleFormSubmitError } from '@/utils/errorHandler';
import { DrawerAction } from '@/hooks/useDrawerAction';
import ModelForm from './form/ModelForm';

type Props = DrawerAction & {
  submitting: boolean;
  readOnly?: boolean;
};

const getDrawerTitle = (formMode: FORM_MODE, name?: string) =>
  ({
    [FORM_MODE.CREATE]: '创建数据模型',
    [FORM_MODE.EDIT]: name,
  })[formMode];

export default function ModelDrawer(props: Props) {
  const {
    visible,
    formMode,
    defaultValue,
    submitting,
    onClose,
    onSubmit,
    readOnly = false,
  } = props;
  const [form] = Form.useForm();
  const currentFormMode = formMode || FORM_MODE.CREATE;

  const afterOpenChange = (open: boolean) => {
    if (!open) {
      form.resetFields();
    }
  };

  const submit = () => {
    form
      .validateFields()
      .then(async (values) => {
        if (!onSubmit) {
          return;
        }
        await onSubmit({ data: values, id: defaultValue?.modelId });
        onClose();
      })
      .catch((error) => {
        handleFormSubmitError(error, '保存数据模型失败，请稍后重试。');
      });
  };

  return (
    <Drawer
      open={visible}
      title={getDrawerTitle(currentFormMode, defaultValue?.displayName)}
      width={750}
      closable
      destroyOnClose
      afterOpenChange={afterOpenChange}
      onClose={onClose}
      footer={
        <Space className="d-flex justify-end">
          <Button onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            type="primary"
            onClick={submit}
            loading={submitting}
            disabled={submitting || readOnly}
          >
            保存
          </Button>
        </Space>
      }
    >
      {visible ? (
        <ModelForm
          formMode={currentFormMode}
          form={form}
          defaultValue={defaultValue}
          active={visible}
        />
      ) : null}
    </Drawer>
  );
}
