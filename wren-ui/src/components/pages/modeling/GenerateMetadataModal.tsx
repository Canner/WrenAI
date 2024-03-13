import { Modal, Form } from 'antd';
import { ModalAction } from '@/hooks/useModalAction';
import { NODE_TYPE } from '@/utils/enum';
import GenerateModelMetadata, {
  Props as GenerateModelProps,
} from '@/components/pages/modeling/metadata/GenerateModelMetadata';
import GenerateViewMetadata, {
  Props as GenerateViewProps,
} from '@/components/pages/modeling/metadata/GenerateViewMetadata';
import { EditableContext } from '@/components/EditableWrapper';

type DefaultValue = (GenerateModelProps & GenerateViewProps) & {
  nodeType: NODE_TYPE;
};

type Props = ModalAction<DefaultValue> & {
  loading?: boolean;
};

const getDrawerTitle = (nodeType: NODE_TYPE) => {
  return (
    {
      [NODE_TYPE.MODEL]: "Generate model's metadata",
      [NODE_TYPE.VIEW]: "Generate view's metadata",
    }[nodeType] || 'Generate metadata'
  );
};

const formNamespace = 'generatedMetadata';

export default function GenerateMetadataModal(props: Props) {
  const { visible, defaultValue, loading, onSubmit, onClose } = props;
  const { nodeType } = defaultValue || {};

  const [form] = Form.useForm();

  const submit = async () => {
    const values = form.getFieldValue(formNamespace);
    await onSubmit(values);
    onClose();
  };

  return (
    <Modal
      title={getDrawerTitle(nodeType)}
      width={700}
      visible={visible}
      okText="Submit"
      onOk={submit}
      onCancel={onClose}
      confirmLoading={loading}
      maskClosable={false}
      destroyOnClose
      centered
    >
      <EditableContext.Provider value={form}>
        <Form form={form} component={false}>
          {nodeType === NODE_TYPE.MODEL && (
            <GenerateModelMetadata
              formNamespace={formNamespace}
              {...defaultValue}
            />
          )}
          {nodeType === NODE_TYPE.VIEW && (
            <GenerateViewMetadata
              formNamespace={formNamespace}
              {...(defaultValue as GenerateModelProps)}
            />
          )}
        </Form>
      </EditableContext.Provider>
    </Modal>
  );
}
