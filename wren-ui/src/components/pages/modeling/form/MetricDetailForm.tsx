import { useMemo } from 'react';
import { Form, FormInstance, Select, Radio, Button, Space } from 'antd';
import { FORM_MODE } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import PreviewDataContent from '@/components/PreviewDataContent';
import MeasureTableFormControl, {
  MeasureTableValue,
} from '@/components/tableFormControls/MeasureTableFormControl';
import DimensionTableFormControl, {
  DimensionTableValue,
} from '@/components/tableFormControls/DimensionTableFormControl';
import WindowTableFormControl, {
  WindowTableValue,
} from '@/components/tableFormControls/WindowTableFormControl';
import useMetricDetailFormOptions from '@/hooks/useMetricDetailFormOptions';

export interface ButtonProps {
  form: FormInstance;
  onPreview: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  onBack: () => void;
}

const RADIO_VALUE = {
  SIMPLE: 'simple',
  CUMULATIVE: 'cumulative',
};

const getPreviewColumns = (
  measures: MeasureTableValue,
  dimensions: DimensionTableValue,
  windows: WindowTableValue,
) => {
  return [
    measures.map((field) => field.name),
    dimensions.map((field) => field.name),
    windows.map((field) => field.name),
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
  const { form } = props;

  const metricName = form.getFieldValue('metricName');
  const metricType = Form.useWatch('metricType', form);
  const measures = Form.useWatch('measures', form) || [];
  const dimensions = Form.useWatch('dimensions', form) || [];
  const windows = Form.useWatch('windows', form) || [];

  const { modelMetricOptions } = useMetricDetailFormOptions();

  const onMetricTypeChange = (value) => {
    if (metricType !== value) {
      form.setFieldsValue({
        dimensions: undefined,
        windows: undefined,
      });
    }
  };

  const previewColumns = useMemo(() => {
    return getPreviewColumns(measures, dimensions, windows);
  }, [measures, dimensions, windows]);

  return (
    <Form form={form} layout="vertical">
      <Form.Item
        label="Select a model or metric"
        name="source"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.MODELING_CREATE_METRIC.SOURCE.REQUIRED,
          },
        ]}
      >
        <Select
          placeholder="Select a model or metric"
          options={modelMetricOptions}
        />
      </Form.Item>

      <Form.Item
        label="Type"
        name="metricType"
        initialValue={RADIO_VALUE.SIMPLE}
      >
        <Radio.Group onChange={onMetricTypeChange}>
          <Radio value={RADIO_VALUE.SIMPLE}>Simple</Radio>
          <Radio value={RADIO_VALUE.CUMULATIVE}>Cumulative</Radio>
        </Radio.Group>
      </Form.Item>

      <Form.Item label="Measures" name="measures">
        <MeasureTableFormControl modalProps={{ model: metricName }} />
      </Form.Item>

      {metricType === RADIO_VALUE.SIMPLE && (
        <Form.Item label="Dimensions" name="dimensions">
          <DimensionTableFormControl modalProps={{ model: metricName }} />
        </Form.Item>
      )}

      {metricType === RADIO_VALUE.CUMULATIVE && (
        <Form.Item label="Windows" name="windows">
          <WindowTableFormControl modalProps={{ model: metricName }} />
        </Form.Item>
      )}

      <Form.Item label="Data preview (50 rows)">
        <PreviewDataContent columns={previewColumns} data={[]} />
      </Form.Item>
    </Form>
  );
}

export const ButtonGroup = (props: ButtonProps) => {
  const { form, onPreview, onCancel, onBack, onSubmit } = props;
  const measures = Form.useWatch('measures', form) || [];
  const dimensions = Form.useWatch('dimensions', form) || [];
  const windows = Form.useWatch('windows', form) || [];

  const canPreview = useMemo(() => {
    return measures.length > 0 || dimensions.length > 0 || windows.length > 0;
  }, [measures, dimensions, windows]);

  return (
    <div className="d-flex justify-space-between">
      <Button onClick={onPreview} disabled={!canPreview}>
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
