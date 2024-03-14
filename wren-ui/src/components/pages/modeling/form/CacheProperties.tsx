import { useEffect, useState } from 'react';
import { Form, Switch, Input, Select, Space, FormInstance } from 'antd';
import { getCachePeriodText } from '@/utils/data';
import { CACHED_PERIOD } from '@/utils/enum';

const splitCachedPeriod = (cachedPeriod: string) => {
  const period = (cachedPeriod || '').split(/(?=\D)/);
  const duration = period[0];
  const durationUnit = period[period.length - 1];
  return { duration, durationUnit };
};

const CachedPeriodControl = (props: {
  value?: string;
  onChange?: (value: string) => void;
}) => {
  const { value, onChange } = props;
  const [internalValue, setInternalValue] = useState(
    value ? splitCachedPeriod(value) : null,
  );

  const syncOnChange = () => {
    if (internalValue.duration && internalValue.durationUnit) {
      onChange &&
        onChange(`${internalValue.duration}${internalValue.durationUnit}`);
    }
  };

  useEffect(syncOnChange, [internalValue]);

  const inputChange = (event) => {
    setInternalValue({ ...internalValue, duration: event.target.value });
  };
  const selectChange = (durationUnit) => {
    setInternalValue({ ...internalValue, durationUnit });
  };

  return (
    <Space className="ml-2">
      <Input
        style={{ width: 100 }}
        min={1}
        type="number"
        onChange={inputChange}
        value={internalValue.duration}
      />
      <Select
        style={{ width: 160 }}
        onChange={selectChange}
        value={internalValue.durationUnit}
        options={[
          {
            label: getCachePeriodText(CACHED_PERIOD.SECOND),
            value: CACHED_PERIOD.SECOND,
          },
          {
            label: getCachePeriodText(CACHED_PERIOD.MINUTE),
            value: CACHED_PERIOD.MINUTE,
          },
          {
            label: getCachePeriodText(CACHED_PERIOD.HOUR),
            value: CACHED_PERIOD.HOUR,
          },
          {
            label: getCachePeriodText(CACHED_PERIOD.DAY),
            value: CACHED_PERIOD.DAY,
          },
        ]}
      />
    </Space>
  );
};

export default function CacheProperties(props: { form: FormInstance }) {
  const cached = Form.useWatch('cached', props.form);
  return (
    <>
      <Form.Item label="Cache" name="cached" valuePropName="checked">
        <Switch />
      </Form.Item>
      {cached && (
        <Form.Item label="Cache refresh schedule">
          Every
          <Form.Item
            name="refreshTime"
            noStyle
            initialValue={`1${CACHED_PERIOD.HOUR}`}
          >
            <CachedPeriodControl />
          </Form.Item>
        </Form.Item>
      )}
    </>
  );
}
