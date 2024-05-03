import { Modal, Form } from 'antd';
import { ModalAction } from '@/hooks/useModalAction';
import { NODE_TYPE } from '@/utils/enum';
import EditModelMetadata, {
  Props as EditModelProps,
} from '@/components/pages/modeling/metadata/EditModelMetadata';
import { EditableContext } from '@/components/EditableWrapper';

type DefaultValue = EditModelProps & {
  modelId: number;
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
    const values = form.getFieldValue(formNamespace);
    await onSubmit({ data: values, id: defaultValue?.modelId });
    onClose();
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
              {...defaultValue}
            />
          )}
        </Form>
      </EditableContext.Provider>
    </Modal>
  );
}
