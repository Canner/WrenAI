import { useEffect } from 'react';
import { Button, Form, Input, Modal, Row, Col, Radio } from 'antd';
import { useTranslations } from 'next-intl';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import { isEmpty } from 'lodash';
import { FORM_MODE } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import { ModalAction } from '@/hooks/useModalAction';
import { Instruction } from '@/apollo/client/graphql/__types__';

const MAX_QUESTIONS = 100;

type Props = ModalAction<Instruction> & {
  loading?: boolean;
};

export default function InstructionModal(props: Props) {
  const { defaultValue, formMode, loading, onClose, onSubmit, visible } = props;
  const t = useTranslations();

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
        await onSubmit({ data, id: defaultValue?.id });
        onClose();
      })
      .catch(console.error);
  };

  return (
    <Modal
      title={
        isCreateMode
          ? t('instructionModal.addTitle')
          : t('instructionModal.updateTitle')
      }
      centered
      closable
      confirmLoading={loading}
      destroyOnClose
      maskClosable={false}
      onCancel={onClose}
      visible={visible}
      width={720}
      cancelButtonProps={{ disabled: loading }}
      okText={t('actions.submit')}
      onOk={onSubmitButton}
      afterClose={() => form.resetFields()}
    >
      <Form form={form} preserve={false} layout="vertical">
        <Form.Item
          label={t('page.instructionDetails')}
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
            placeholder={t('instructionModal.instructionPlaceholder')}
            maxLength={1000}
            rows={3}
            showCount
          />
        </Form.Item>
        <Form.Item
          label={t('instructionModal.applyTo')}
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
              Choose whether this instruction applies to{' '}
              <span className="gray-7">{t('instructionModal.allQueries')}</span>{' '}
              {t('instructionModal.or')}{' '}
              <span className="gray-7">
                {t('instructionModal.onlyWhenSimilarDetected')}
              </span>
              .
            </>
          }
        >
          <Radio.Group>
            <Radio.Button value={true}>
              {t('instructionModal.globalOption')}
            </Radio.Button>
            <Radio.Button value={false}>
              {t('instructionModal.matchedOption')}
            </Radio.Button>
          </Radio.Group>
        </Form.Item>
        {!isDefault && (
          <Form.Item
            label={t('page.matchingQuestions')}
            required
            extra={t('instructionModal.matchingQuestionsHelp')}
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
                            placeholder={t(
                              'instructionModal.questionPlaceholder',
                            )}
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
                          style={{ border: 'none' }}
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
                      {t('instructionModal.addQuestion')}
                    </Button>
                  </Form.Item>
                </>
              )}
            </Form.List>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
