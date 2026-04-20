import { useEffect, useMemo } from 'react';
import { keyBy } from 'lodash';
import styled from 'styled-components';
import { Form, Modal, Select, Tag, type SelectProps } from 'antd';
import QuestionCircleOutlined from '@ant-design/icons/QuestionCircleOutlined';
import { ERROR_TEXTS } from '@/utils/error';
import { handleFormSubmitError } from '@/utils/errorHandler';
import useAutoComplete, { convertMention } from '@/hooks/useAutoComplete';
import { ModalAction } from '@/hooks/useModalAction';
import MarkdownEditor from '@/components/editor/MarkdownEditor';
import useModelList from '@/hooks/useModelList';

const MultiSelect = styled(Select)`
  .ant-select-selector {
    padding-top: 3px;
  }
  .ant-tag {
    padding: 3px 5px;
    margin-right: 3px;
    margin-bottom: 3px;
  }
`;

const TagText = styled.div`
  line-height: 16px;
`;

type Props = ModalAction<{
  responseId: number;
  retrievedTables: string[];
  sqlGenerationReasoning: string;
}> & {
  loading?: boolean;
};

export default function AdjustReasoningStepsModal(props: Props) {
  const { visible, defaultValue, loading, onSubmit, onClose } = props;
  const [form] = Form.useForm();

  const mentions = useAutoComplete({
    convertor: convertMention,
    includeColumns: true,
    skip: !visible,
  });
  const { data: modelListData } = useModelList({
    enabled: visible,
  });
  const listModels = modelListData || [];
  const modelNameMap = keyBy(listModels, 'referenceName');
  const modelOptions = useMemo(() => {
    return listModels.map((model) => ({
      label: model.displayName,
      value: model.referenceName,
    }));
  }, [listModels]);

  useEffect(() => {
    if (!visible) return;
    const retrievedTables = listModels.reduce<string[]>((result, model) => {
      if (defaultValue?.retrievedTables.includes(model.referenceName)) {
        result.push(model.referenceName);
      }
      return result;
    }, []);
    form.setFieldsValue({
      tables: retrievedTables,
      sqlGenerationReasoning: defaultValue?.sqlGenerationReasoning,
    });
  }, [form, defaultValue, visible, listModels]);

  const tagRender: SelectProps['tagRender'] = (props) => {
    if (!props) {
      return <span />;
    }
    const { value, closable, onClose } = props;
    const model = modelNameMap[value as string];
    if (!model) {
      return <span />;
    }
    return (
      <Tag
        onMouseDown={(e) => e.stopPropagation()}
        closable={closable}
        onClose={onClose}
        className="d-flex align-center bg-gray-3 border-gray-3"
        style={{ maxWidth: 140 }}
      >
        <div className="pr-1" style={{ minWidth: 0 }}>
          <TagText className="gray-8 text-truncate" title={model.displayName}>
            {model.displayName}
          </TagText>
          <TagText
            className="gray-7 text-xs text-truncate"
            title={model.referenceName}
          >
            {model.referenceName}
          </TagText>
        </div>
      </Tag>
    );
  };

  const reset = () => {
    form.resetFields();
  };

  const submit = async () => {
    form
      .validateFields()
      .then(async (values) => {
        if (!defaultValue || !onSubmit) {
          return;
        }
        await onSubmit({
          responseId: defaultValue.responseId,
          data: values,
        });
        onClose();
      })
      .catch((error) => {
        handleFormSubmitError(error, '调整步骤失败，请稍后重试。');
      });
  };

  return (
    <Modal
      title="调整步骤"
      width={640}
      open={visible}
      okText="重新生成回答"
      cancelText="取消"
      onOk={submit}
      onCancel={onClose}
      confirmLoading={loading}
      maskClosable={false}
      destroyOnHidden
      centered
      afterClose={reset}
    >
      <Form form={form} preserve={false} layout="vertical">
        <Form.Item
          label="已选模型"
          name="tables"
          required={false}
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.ADJUST_REASONING.SELECTED_MODELS.REQUIRED,
            },
          ]}
          extra={
            <div className="text-sm gray-6 mt-1">
              选择回答当前问题所需的数据模型。{' '}
              <span className="gray-7">未选中的模型不会参与 SQL 生成。</span>
            </div>
          }
        >
          <MultiSelect
            mode="multiple"
            placeholder="请选择模型"
            options={modelOptions}
            tagRender={tagRender}
          />
        </Form.Item>
        <Form.Item
          label="推理步骤"
          className="pb-0"
          extra={
            <div className="text-sm gray-6 mt-1">
              <QuestionCircleOutlined className="mr-1" />
              提示：可在文本框中输入 @ 来插入模型。
            </div>
          }
        >
          <div className="text-sm gray-6 mb-1">
            编辑下面的分析逻辑，让每一步都更贴近问题目标并帮助生成更准确的回答。
          </div>
          <Form.Item
            noStyle
            name="sqlGenerationReasoning"
            required={false}
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.ADJUST_REASONING.STEPS.REQUIRED,
              },
              {
                max: 6000,
                message: ERROR_TEXTS.ADJUST_REASONING.STEPS.MAX_LENGTH,
              },
            ]}
          >
            <MarkdownEditor maxLength={6000} mentions={mentions} />
          </Form.Item>
        </Form.Item>
      </Form>
    </Modal>
  );
}
