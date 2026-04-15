import React, { useCallback, useMemo } from 'react';
import { Select } from 'antd';
import { compactObject, parseJson } from '@/utils/helper';

export interface Option {
  label: string | JSX.Element;
  value?: unknown;
  options?: Option[];
}

interface Props extends React.ComponentProps<typeof Select> {
  options: Option[];
}

const getOption = (item: Option) => {
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

  const handleChange = useCallback(
    (optionValue: string | string[], option: unknown) => {
      const parsedValue = Array.isArray(optionValue)
        ? optionValue.map((value) => parseJson(value))
        : parseJson(optionValue);

      onChange && onChange(parsedValue as any, option as any);
    },
    [onChange],
  );

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
      value={antdValue as any}
      options={antdSelectOptions as any}
      onChange={handleChange as any}
      {...restProps}
    />
  );
}
