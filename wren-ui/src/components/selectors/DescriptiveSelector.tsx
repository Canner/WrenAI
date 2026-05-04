import React, { useState } from 'react';
import { Select, SelectProps, Space, Typography } from 'antd';
import styled from 'styled-components';
import { omit } from 'lodash';

interface Props extends SelectProps {
  listHeight?: number;
  descriptiveContentRender?: (option: any) => React.ReactNode;
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
          <b>Description</b>
        </div>
        {content?.description || '-'}
      </div>
      <div>
        <div style={{ marginBottom: 4 }}>
          <b>Example</b>
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
  // Condition when met group option
  const [firstOption] = options;
  const [currentOption, setCurrentOption] = useState<any>(
    firstOption.options ? firstOption.options[0] : firstOption,
  );
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
              : defaultDescriptiveContentRender)(currentOption?.content)}
          </div>
        </div>
      </DescribeBox>
    );
  };

  const extendOptionMouseEnter = (option) => {
    setCurrentOption(option);
  };

  const getOptionStructure = (option) => ({
    ...omit(option, ['content']),
    'data-value': option.value,
    onMouseEnter: (event) => {
      extendOptionMouseEnter(option);
      option.onMouseEnter && option.onMouseEnter(event);
    },
  });

  const mainOptions = options.map((option) => {
    const isOptionGroup = Boolean(option.options);
    return isOptionGroup
      ? { ...option, options: option.options!.map(getOptionStructure) }
      : getOptionStructure(option);
  }) as SelectProps['options'];

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
