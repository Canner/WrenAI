import { Modal, Form } from 'antd';
import { ModalAction } from '@/hooks/useModalAction';
import { NODE_TYPE } from '@/utils/enum';
import { EditableContext } from '@/components/EditableWrapper';
import EditModelMetadata, {
  Props as EditModelProps,
} from '@/components/pages/modeling/metadata/EditModelMetadata';
import EditViewMetadata, {
  Props as EditViewProps,
} from '@/components/pages/modeling/metadata/EditViewMetadata';

type DefaultValue = (EditModelProps | EditViewProps) & {
  nodeType: NODE_TYPE;
};

type Props = ModalAction<DefaultValue> & {
  loading?: boolean;
};

const formNamespace = 'metadata';

export default function EditMetadataModal(props: Props) {
  const { visible, defaultValue, loading, onSubmit, onClose } = props;
  const { nodeType } = defaultValue || {};

  const [form] = Form.useForm();

  const submit = async () => {
    form
      .validateFields()
      .then(async () => {
        // Get the saved metadata values to submit if there is no editing failed
        const values = form.getFieldValue(formNamespace);
        await onSubmit({ data: values, nodeType });
        onClose();
      })
      .catch(console.error);
  };

  return (
    <Modal
      title="Edit metadata"
      width={800}
      visible={visible}
      okText="Submit"
      onOk={submit}
      onCancel={onClose}
      confirmLoading={loading}
      maskClosable={false}
      destroyOnClose
      centered
      afterClose={() => form.resetFields()}
    >
      <EditableContext.Provider value={form}>
        <Form form={form} component={false}>
          {nodeType === NODE_TYPE.MODEL && (
            <EditModelMetadata
              formNamespace={formNamespace}
              {...(defaultValue as EditModelProps)}
            />
          )}

          {nodeType === NODE_TYPE.VIEW && (
            <EditViewMetadata
              formNamespace={formNamespace}
              {...(defaultValue as EditViewProps)}
            />
          )}
        </Form>
      </EditableContext.Provider>
    </Modal>
  );
}
