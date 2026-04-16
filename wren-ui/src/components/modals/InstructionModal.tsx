import { useEffect } from 'react';
import { Button, Form, Input, Modal, Row, Col, Radio, message } from 'antd';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import { isEmpty } from 'lodash';
import styled from 'styled-components';
import { FORM_MODE } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import { handleFormSubmitError } from '@/utils/errorHandler';
import { ModalAction } from '@/hooks/useModalAction';
import { Instruction } from '@/types/api';

const MAX_QUESTIONS = 100;

const StyledModal = styled(Modal)`
  .ant-modal-content {
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid #e5e7eb;
    box-shadow: 0 20px 56px rgba(15, 23, 42, 0.12);
  }

  .ant-modal-header {
    padding: 18px 20px;
    border-bottom: 1px solid #eef2f7;
  }

  .ant-modal-title {
    font-size: 18px;
    font-weight: 700;
    color: #111827;
  }

  .ant-modal-body {
    padding: 20px;
  }

  .ant-modal-footer {
    padding: 16px 20px 20px;
    border-top: 1px solid #eef2f7;
  }
`;

const StyledForm = styled(Form)`
  .ant-form-item {
    margin-bottom: 18px;
  }

  .ant-form-item-label > label {
    font-size: 13px;
    font-weight: 600;
    color: #4b5563;
  }

  .ant-input,
  .ant-input-affix-wrapper {
    border-radius: 10px;
    border-color: #dbe2ea;
    box-shadow: none;
  }

  .ant-input {
    min-height: 40px;
    padding: 8px 12px;
  }

  .ant-input-textarea .ant-input {
    min-height: 120px;
  }

  .ant-radio-group {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .ant-radio-button-wrapper {
    height: 36px;
    line-height: 34px;
    border-radius: 8px;
    border: 1px solid #e5e7eb;
    background: #f8fafc;
    box-shadow: none;
  }

  .ant-radio-button-wrapper:not(:first-child)::before {
    display: none;
  }

  .ant-radio-button-wrapper-checked:not(.ant-radio-button-wrapper-disabled) {
    color: #7b55e8;
    border-color: rgba(123, 85, 232, 0.22);
    background: rgba(123, 85, 232, 0.08);
  }
`;

type Props = ModalAction<Instruction> & {
  loading?: boolean;
};

export default function InstructionModal(props: Props) {
  const { defaultValue, formMode, loading, onClose, onSubmit, visible } = props;

  const isCreateMode = formMode === FORM_MODE.CREATE;

  const [form] = Form.useForm();
  const isDefault = Form.useWatch('isDefault', form);

  useEffect(() => {
    if (visible) {
      form.setFieldsValue({
        isDefault: isEmpty(defaultValue) ? true : defaultValue.isDefault,
        instruction: defaultValue?.instruction,
        questions: defaultValue?.questions,
      });
    }
  }, [visible, defaultValue]);

  const onSubmitButton = () => {
    form
      .validateFields()
      .then(async (values) => {
        const data = {
          isDefault: values.isDefault,
          instruction: values.instruction,
          questions: values?.questions || [],
        };
        if (!onSubmit) {
          return;
        }
        await onSubmit({ data, id: defaultValue?.id });
        onClose();
      })
      .catch((error) => {
        if (error instanceof Error && error.message) {
          message.error(error.message);
          return;
        }
        handleFormSubmitError(error, '提交规则失败，请稍后重试。');
      });
  };

  return (
    <StyledModal
      title={isCreateMode ? '新增分析规则' : '更新分析规则'}
      centered
      closable
      confirmLoading={loading}
      destroyOnClose
      maskClosable={false}
      onCancel={onClose}
      visible={visible}
      width={720}
      cancelButtonProps={{ disabled: loading }}
      okText="提交"
      onOk={onSubmitButton}
      afterClose={() => form.resetFields()}
    >
      <StyledForm form={form} preserve={false} layout="vertical">
        <Form.Item
          label="规则内容"
          name="instruction"
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.INSTRUCTION.DETAILS.REQUIRED,
            },
          ]}
        >
          <Input.TextArea
            autoFocus
            placeholder="输入生成 SQL 时需要遵循的业务规则、口径或约束条件。"
            maxLength={1000}
            rows={3}
            showCount
          />
        </Form.Item>
        <Form.Item
          label="规则生效范围"
          name="isDefault"
          required={false}
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.INSTRUCTION.IS_DEFAULT_GLOBAL.REQUIRED,
            },
          ]}
          extra={
            <>
              选择这条规则是对 <span className="gray-7">所有问题</span>{' '}
              生效，还是仅在
              <span className="gray-7">识别到相似问题</span> 时启用。
            </>
          }
        >
          <Radio.Group>
            <Radio.Button value={true}>全局生效（适用于所有问题）</Radio.Button>
            <Radio.Button value={false}>按问题匹配生效</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {!isDefault && (
          <Form.Item
            label="匹配问题示例"
            required
            extra="系统会基于问题相似度进行匹配，并在相关提问出现时自动应用这条规则。"
          >
            <Form.List name="questions" initialValue={['']}>
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Row key={key} wrap={false} gutter={8} className="my-2">
                      <Col flex="1 0">
                        <Form.Item
                          {...restField}
                          name={name}
                          required
                          className="mb-2"
                          style={{ width: '100%' }}
                          rules={[
                            {
                              required: true,
                              whitespace: true,
                              message:
                                ERROR_TEXTS.INSTRUCTION.QUESTIONS.REQUIRED,
                            },
                          ]}
                        >
                          <Input
                            placeholder="输入会触发这条规则的示例问题。"
                            maxLength={100}
                            showCount
                          />
                        </Form.Item>
                      </Col>
                      <Col flex="none" className="p-1">
                        <Button
                          onClick={() => remove(name)}
                          disabled={fields.length <= 1}
                          icon={<DeleteOutlined />}
                          size="small"
                          style={{ border: 'none', borderRadius: 8 }}
                          className="bg-gray-1"
                        />
                      </Col>
                    </Row>
                  ))}
                  <Form.Item noStyle>
                    <Button
                      type="dashed"
                      onClick={() => add()}
                      block
                      icon={<PlusOutlined />}
                      disabled={fields.length >= MAX_QUESTIONS}
                      className="mb-1"
                    >
                      新增示例问题
                    </Button>
                  </Form.Item>
                </>
              )}
            </Form.List>
          </Form.Item>
        )}
      </StyledForm>
    </StyledModal>
  );
}
