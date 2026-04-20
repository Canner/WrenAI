import { Modal, Form } from 'antd';
import { ModalAction } from '@/hooks/useModalAction';
import { NODE_TYPE } from '@/utils/enum';
import { handleFormSubmitError } from '@/utils/errorHandler';
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
  const { formNamespace: _modelFormNamespace, ...modelMetadataProps } =
    ((defaultValue as EditModelProps) || {}) as EditModelProps;
  const { formNamespace: _viewFormNamespace, ...viewMetadataProps } =
    ((defaultValue as EditViewProps) || {}) as EditViewProps;

  const [form] = Form.useForm();

  const submit = async () => {
    form
      .validateFields()
      .then(async () => {
        // Get the saved metadata values to submit if there is no editing failed
        const values = form.getFieldValue(formNamespace);
        await onSubmit?.({ data: values, nodeType });
        onClose();
      })
      .catch((error) => {
        handleFormSubmitError(error, '保存元数据失败，请稍后重试。');
      });
  };

  return (
    <Modal
      title="编辑元数据"
      width={800}
      open={visible}
      okText="保存"
      cancelText="取消"
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
              {...modelMetadataProps}
            />
          )}

          {nodeType === NODE_TYPE.VIEW && (
            <EditViewMetadata
              formNamespace={formNamespace}
              {...viewMetadataProps}
            />
          )}
        </Form>
      </EditableContext.Provider>
    </Modal>
  );
}
