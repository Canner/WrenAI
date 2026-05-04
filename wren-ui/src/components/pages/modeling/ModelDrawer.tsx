import { Button, Drawer, Form, Space } from 'antd';
import { FORM_MODE } from '@/utils/enum';
import { DrawerAction } from '@/hooks/useDrawerAction';
import ModelForm from './form/ModelForm';

type Props = DrawerAction & {
  submitting: boolean;
};

const getDrawerTitle = (formMode: FORM_MODE, name?: string) =>
  ({
    [FORM_MODE.CREATE]: 'Create a data model',
    [FORM_MODE.EDIT]: name,
  })[formMode];

export default function ModelDrawer(props: Props) {
  const { visible, formMode, defaultValue, submitting, onClose, onSubmit } =
    props;
  const [form] = Form.useForm();

  const afterVisibleChange = (visible: boolean) => {
    if (!visible) {
      form.resetFields();
    }
  };

  const submit = () => {
    form
      .validateFields()
      .then(async (values) => {
        await onSubmit({ data: values, id: defaultValue?.modelId });
        onClose();
      })
      .catch(console.error);
  };

  return (
    <Drawer
      visible={visible}
      title={getDrawerTitle(formMode, defaultValue?.displayName)}
      width={750}
      closable
      destroyOnClose
      afterVisibleChange={afterVisibleChange}
      onClose={onClose}
      footer={
        <Space className="d-flex justify-end">
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="primary"
            onClick={submit}
            loading={submitting}
            disabled={submitting}
          >
            Submit
          </Button>
        </Space>
      }
    >
      <ModelForm formMode={formMode} form={form} defaultValue={defaultValue} />
    </Drawer>
  );
}
