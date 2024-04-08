import { useEffect, useMemo } from 'react';
import { Form, FormInstance, Radio, Select, Button, Space } from 'antd';
import { FORM_MODE } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import Editor from '@/components/editor';
import Selector from '@/components/selectors/Selector';
import CalulatedFieldTableFormControl, {
  CalculatedFieldTableValue,
} from '@/components/tableFormControls/CalculatedFieldTableFormControl';
import useModelDetailFormOptions from '@/hooks/useModelDetailFormOptions';
import PreviewDataContent from '@/components/PreviewDataContent';

export interface ButtonProps {
  form: FormInstance;
  onPreview: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  onBack: () => void;
}

type FieldValue = { name: string; type: string };

const RADIO_VALUE = {
  TABLE: 'table',
  CUSTOM: 'custom',
};

const getPreviewColumns = (
  fields: FieldValue[],
  calculatedFields: CalculatedFieldTableValue,
) => {
  return [
    fields.map((field) => field.name),
    calculatedFields.map((field) => field.name),
  ]
    .flat()
    .map((name) => ({
      title: name,
      dataIndex: name,
    }));
};

export default function ModelDetailForm(props: {
  form: FormInstance;
  formMode: FORM_MODE;
}) {
  const { form, formMode } = props;

  const modelName = form.getFieldValue('name');
  const sourceType = Form.useWatch('sourceType', form);
  const table = Form.useWatch('table', form);
  const customSQL = Form.useWatch('customSQL', form);
  const fields: FieldValue[] = Form.useWatch('fields', form) || [];
  const calculatedFields: CalculatedFieldTableValue =
    Form.useWatch('calculatedFields', form) || [];

  const {
    dataSourceTableOptions,
    dataSourceTableColumnOptions,
    autoCompleteSource,
  } = useModelDetailFormOptions({ selectedTable: table });

  // Reset fields when table is changed.
  useEffect(() => {
    const allColumnNames = dataSourceTableColumnOptions.map(
      (option) => option.value?.name,
    );
    const isTableChange = fields.some(
      (field) => !allColumnNames.includes(field.name),
    );
    if (isTableChange) form.setFieldsValue({ fields: [] });
  }, [dataSourceTableColumnOptions]);

  const onSourceChange = (value) => {
    if (sourceType !== value) {
      form.setFieldsValue({
        table: undefined,
        customSQL: undefined,
        fields: undefined,
        calculatedFields: undefined,
      });
    }
  };

  // The transientData is used to get the model fields which are not created in DB yet.
  const transientData = useMemo(() => {
    return formMode === FORM_MODE.CREATE
      ? [
          {
            name: modelName,
            columns: fields.map((field) => ({
              name: field.name,
              properties: { type: field.type },
            })),
          },
        ]
      : undefined;
  }, [fields]);

  const previewColumns = useMemo(() => {
    return getPreviewColumns(fields, calculatedFields);
  }, [fields, calculatedFields]);

  return (
    <Form form={form} layout="vertical">
      <Form.Item
        label="Create model from"
        name="sourceType"
        initialValue={RADIO_VALUE.TABLE}
      >
        <Radio.Group onChange={onSourceChange}>
          <Radio value={RADIO_VALUE.TABLE}>Table</Radio>
          <Radio value={RADIO_VALUE.CUSTOM}>Custom SQL statement</Radio>
        </Radio.Group>
      </Form.Item>

      {sourceType === RADIO_VALUE.TABLE && (
        <>
          <Form.Item
            label="Select a table"
            name="table"
            required
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.MODELING_CREATE_MODEL.TABLE.REQUIRED,
              },
            ]}
          >
            <Select
              placeholder="Select a table"
              options={dataSourceTableOptions}
            />
          </Form.Item>
          <Form.Item
            label="Select fields"
            name="fields"
            required
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.MODELING_CREATE_MODEL.FIELDS.REQUIRED,
              },
            ]}
          >
            <Selector
              mode="multiple"
              placeholder="Select fields"
              disabled={!(table || customSQL)}
              options={dataSourceTableColumnOptions}
            />
          </Form.Item>
          <Form.Item label="Calculated fields" name="calculatedFields">
            <CalulatedFieldTableFormControl
              modalProps={{ model: modelName, transientData }}
            />
          </Form.Item>
        </>
      )}

      {sourceType === RADIO_VALUE.CUSTOM && (
        <Form.Item
          name="customSQL"
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.MODELING_CREATE_MODEL.CUSTOM_SQL.REQUIRED,
            },
          ]}
        >
          <Editor autoCompleteSource={autoCompleteSource} />
        </Form.Item>
      )}

      <Form.Item label="Data preview (50 rows)">
        <PreviewDataContent
          loading={false}
          columns={previewColumns}
          data={[]}
        />
      </Form.Item>
    </Form>
  );
}

export const ButtonGroup = (props: ButtonProps) => {
  const { form, onPreview, onCancel, onBack, onSubmit } = props;
  const fields = Form.useWatch('fields', form) || [];
  return (
    <div className="d-flex justify-space-between">
      <Button onClick={onPreview} disabled={!fields.length}>
        Preview data
      </Button>
      <Space className="d-flex justify-end">
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={onBack}>Back</Button>
        <Button type="primary" onClick={onSubmit}>
          Submit
        </Button>
      </Space>
    </div>
  );
};
