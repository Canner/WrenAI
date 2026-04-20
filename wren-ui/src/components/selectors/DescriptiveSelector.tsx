import React, { useState } from 'react';
import { Select, SelectProps, Space, Typography } from 'antd';
import styled from 'styled-components';
import { omit } from 'lodash';

type DescriptiveOption = {
  disabled?: boolean;
  label?: React.ReactNode;
  value?: string | number | null;
  key?: React.Key;
  title?: string;
  content?: Record<string, any>;
  options?: DescriptiveOption[];
  onMouseEnter?: (event: React.MouseEvent<HTMLElement>) => void;
  [key: string]: any;
};

interface Props extends SelectProps<any, DescriptiveOption> {
  listHeight?: number;
  descriptiveContentRender?: (option?: Record<string, any>) => React.ReactNode;
  dropdownMatchSelectWidth?: number | boolean;
}

const { Title } = Typography;

const DescribeBox = styled.div`
  display: flex;
  .rc-virtual-list {
    min-width: 230px;
  }

  .describeBox {
    &-codeBlock {
      background: var(--gray-3);
      border-radius: 4px;
      padding: 6px 8px;
    }
  }
`;

const defaultDescriptiveContentRender = (content: Record<string, any>) => {
  return (
    <Space style={{ width: '100%' }} size={[0, 16]} direction="vertical">
      <div>
        <div style={{ marginBottom: 4 }}>
          <b>描述</b>
        </div>
        {content?.description || '-'}
      </div>
      <div>
        <div style={{ marginBottom: 4 }}>
          <b>示例</b>
        </div>
        {content?.example ? (
          <div className="describeBox-codeBlock">{content?.example}</div>
        ) : (
          '-'
        )}
      </div>
    </Space>
  );
};

export default function DescriptiveSelector(props: Props) {
  const {
    mode,
    value,
    options,
    onChange,
    descriptiveContentRender,
    listHeight,
    placeholder,
    dropdownMatchSelectWidth,
  } = props;
  const normalizedOptions = (options || []) as DescriptiveOption[];
  // Condition when met group option
  const [firstOption] = normalizedOptions;
  const [currentOption, setCurrentOption] = useState<
    DescriptiveOption | undefined
  >(firstOption?.options ? firstOption.options[0] : firstOption);
  // if descriptiveContentRender is not provided, the maxHeight will auto set for defaultDescriptiveContentRender
  const maxHeight = descriptiveContentRender ? listHeight : 193;

  const renderDescriptiveMenu = (menu: React.ReactNode) => {
    return (
      <DescribeBox>
        {menu}
        <div
          style={{
            width: '100%',
            borderLeft: '1px solid var(--gray-3)',
            margin: '-4px 0',
            minWidth: 0,
          }}
        >
          <Title
            level={5}
            ellipsis
            style={{
              padding: '8px 16px',
              borderBottom: '1px solid var(--gray-3)',
            }}
          >
            {currentOption?.label || currentOption?.value}
          </Title>
          <div style={{ padding: '4px 16px 12px' }}>
            {(descriptiveContentRender
              ? descriptiveContentRender
              : defaultDescriptiveContentRender)(currentOption?.content || {})}
          </div>
        </div>
      </DescribeBox>
    );
  };

  const extendOptionMouseEnter = (option: DescriptiveOption) => {
    setCurrentOption(option);
  };

  const getOptionStructure = (
    option: DescriptiveOption,
  ): DescriptiveOption => ({
    ...omit(option, ['content']),
    label: option.label ?? option.value,
    'data-value': option.value,
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      extendOptionMouseEnter(option);
      option.onMouseEnter && option.onMouseEnter(event);
    },
  });

  const mainOptions = normalizedOptions.map((option) => {
    const isOptionGroup = Boolean(option.options);
    return isOptionGroup
      ? { ...option, options: (option.options || []).map(getOptionStructure) }
      : getOptionStructure(option);
  }) as SelectProps<any, DescriptiveOption>['options'];

  return (
    <Select
      style={{ width: '100%' }}
      mode={mode}
      options={mainOptions}
      value={value}
      onChange={onChange}
      dropdownRender={renderDescriptiveMenu}
      listHeight={maxHeight}
      placeholder={placeholder}
      dropdownMatchSelectWidth={dropdownMatchSelectWidth}
      data-testid="common__descriptive-select"
    />
  );
}
