import React, { useCallback, useMemo } from 'react';
import { Select } from 'antd';
import { compactObject, parseJson } from '@/utils/helper';

export interface Option {
  label: string | JSX.Element;
  value?: any;
  options?: Option[];
}

interface Props extends React.ComponentProps<typeof Select> {
  options: Option[];
}

const getOption = (item) => {
  const value =
    typeof item.value === 'object' ? JSON.stringify(item.value) : item.value;
  return {
    ...item,
    value,
    'data-testid': 'common__fields__select-option',
  };
};

export default function Selector(props: Props) {
  const { value, onChange, options, ...restProps } = props;

  const handleChange = useCallback((optionValue, option) => {
    const parsedValue = Array.isArray(optionValue)
      ? optionValue.map((value) => parseJson(value))
      : parseJson(optionValue);

    onChange && onChange(parsedValue, option);
  }, []);

  const antdSelectOptions = useMemo(() => {
    return options.map((item) =>
      compactObject({
        ...getOption(item),
        options: item.options?.map(getOption),
      }),
    );
  }, [options]);

  const antdValue = useMemo(() => {
    return Array.isArray(value)
      ? value.map((item) => JSON.stringify(item))
      : JSON.stringify(value);
  }, [value]);

  return (
    <Select
      value={antdValue}
      options={antdSelectOptions}
      onChange={handleChange}
      {...restProps}
    />
  );
}
