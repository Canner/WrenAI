import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Form, Input, Typography, Button, Alert } from 'antd';
import LinkOutlined from '@ant-design/icons/LinkOutlined';
import { appMessage as message } from '@/utils/antdAppBridge';
import { FORM_MODE } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import { DiagramModel } from '@/utils/data/type';
import { ModalAction } from '@/hooks/useModalAction';
import type { CreateCalculatedFieldInput } from '@/types/calculatedField';
import {
  createLineageSelectorNameValidator,
  createLineageSelectorValidator,
} from '@/utils/validator';
import { ERROR_CODES, parseOperationError } from '@/utils/errorHandler';
import { FieldValue } from '@/components/selectors/lineageSelector/FieldSelect';
import useExpressionFieldOptions from '@/hooks/useExpressionFieldOptions';
import LineageSelector, {
  getLineageOptions,
} from '@/components/selectors/lineageSelector';
import DescriptiveSelector from '@/components/selectors/DescriptiveSelector';
import ErrorCollapse from '@/components/ErrorCollapse';

import { validateCalculatedField as validateCalculatedFieldRest } from '@/utils/modelingRest';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';

export type CalculatedFieldValue = {
  name: string;
  expression: string;
  lineage: FieldValue[];
  columnId?: number;

  payload: {
    models: DiagramModel[];
    sourceModel: DiagramModel;
  };
};

type Props = ModalAction<
  CalculatedFieldValue,
  { id?: number; data: CreateCalculatedFieldInput }
> & {
  loading?: boolean;
};

export default function AddCalculatedFieldModal(props: Props) {
  const {
    visible,
    loading,
    onSubmit,
    onClose,
    defaultValue,
    payload,
    formMode,
  } = props;

  const isEditMode = formMode === FORM_MODE.EDIT;
  const [error, setError] =
    useState<ReturnType<typeof parseOperationError>>(null);

  const [form] = Form.useForm();
  const expression = Form.useWatch('expression', form);
  const lineage = Form.useWatch('lineage', form);

  const expressionOptions = useExpressionFieldOptions();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();

  const models = useMemo(() => payload?.models, [payload]);
  const sourceModel = useMemo(() => payload?.sourceModel, [payload]);

  const validateCalculatedFieldName = useCallback(
    async (name: string) => {
      if (!sourceModel) {
        return;
      }
      const result = await validateCalculatedFieldRest(
        runtimeScopeNavigation.selector,
        {
          name,
          modelId: sourceModel.modelId,
          columnId: defaultValue?.columnId,
        },
      );

      return {
        data: {
          validateCalculatedField: result,
        },
      };
    },
    [defaultValue?.columnId, runtimeScopeNavigation.selector, sourceModel],
  );

  useEffect(() => {
    if (!visible) return;
    form.setFieldsValue(defaultValue || {});
  }, [form, defaultValue, visible]);

  const fetchOptions = useCallback(
    async (value: FieldValue) => {
      if (!sourceModel) {
        return [];
      }
      const selectedModel = models.find(
        (model: DiagramModel) => model.referenceName === value.referenceName,
      );
      // use current model options when initial
      return getLineageOptions({
        model: selectedModel,
        sourceModel,
        expression,
        values: lineage,
      });
    },
    [models, lineage, expression],
  );

  const reset = () => {
    setError(null);
    form.resetFields();
  };

  const submit = () => {
    setError(null);
    form
      .validateFields()
      .then(async (values) => {
        if (!sourceModel || !onSubmit) {
          return;
        }
        const id = defaultValue?.columnId;
        const modelId = !id ? sourceModel.modelId : undefined;

        await onSubmit({
          id,
          data: {
            modelId,
            expression: values.expression,
            name: values.name,
            // lineage output example: [relationId1, relationId2, columnId], the last item is always a columnId
            lineage: values.lineage.map(
              (field: FieldValue) => field.relationId || field.columnId,
            ),
          },
        });
        onClose();
      })
      .catch((err) => {
        const operationError = parseOperationError(err);
        if (!operationError) {
          return;
        }
        if (operationError.code === ERROR_CODES.INVALID_CALCULATED_FIELD) {
          setError(operationError);
          return;
        }
        message.error(
          operationError.message || '保存计算字段失败，请稍后重试。',
        );
      });
  };

  return (
    <Modal
      title={`${isEditMode ? '编辑' : '新增'}计算字段`}
      width={750}
      open={visible}
      onCancel={onClose}
      confirmLoading={loading}
      mask={{ closable: false }}
      destroyOnHidden
      afterClose={() => reset()}
      footer={
        <div className="d-flex justify-space-between align-center">
          <div className="text-sm ml-2">
            <LinkOutlined className="gray-6 mr-2" />
            <Typography.Link
              type="secondary"
              href="https://docs.getwren.ai/oss/guide/modeling/models#update-primary-key"
              target="_blank"
              rel="noopener noreferrer"
            >
              如何为模型设置主键
            </Typography.Link>
          </div>
          <div>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={submit} loading={loading}>
              保存
            </Button>
          </div>
        </div>
      }
    >
      <Form form={form} preserve={false} layout="vertical">
        <Form.Item
          label="名称"
          name="name"
          required
          rules={[
            {
              validator: createLineageSelectorNameValidator(
                validateCalculatedFieldName,
              ),
            },
          ]}
        >
          <Input />
        </Form.Item>

        <Form.Item
          label="选择表达式"
          name="expression"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.CALCULATED_FIELD.EXPRESSION.REQUIRED,
            },
          ]}
        >
          <DescriptiveSelector
            placeholder="请选择表达式"
            options={expressionOptions}
            descriptiveContentRender={(content) => {
              return (
                <>
                  <div className="mb-1">{content?.description || '-'}</div>
                  {content?.expression && (
                    <Typography.Text className="mb-1" code>
                      {content.expression}
                    </Typography.Text>
                  )}
                </>
              );
            }}
          />
        </Form.Item>
        <div className="py-1" />
        {!!expression && (
          <Form.Item
            name="lineage"
            rules={[
              {
                validator: createLineageSelectorValidator(expression),
              },
            ]}
          >
            <LineageSelector
              sourceModel={sourceModel}
              onFetchOptions={fetchOptions}
            />
          </Form.Item>
        )}
      </Form>

      {!!error && (
        <Alert
          showIcon
          type="error"
          message={error.shortMessage || '计算字段校验失败'}
          description={
            <ErrorCollapse
              message={error.message || '未知错误，请稍后重试。'}
            />
          }
        />
      )}
    </Modal>
  );
}
