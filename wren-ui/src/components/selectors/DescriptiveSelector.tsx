import React, { useState } from 'react';
import { Select, Space, Typography } from 'antd';
import styled from 'styled-components';
import { omit } from 'lodash';

export interface Option<TContent = Record<string, any>> {
  [key: string]: any;
  label: string;
  value?: string;
  className?: string;
  disabled?: boolean;
  content?: TContent;
  options?: Option[];
}

interface Props {
  options: Option[];
  value?: string | string[] | null;
  mode?: 'multiple' | 'tags';
  listHeight?: number;
  onChange?: (value: any) => void;
  descriptiveContentRender?: (option: any) => React.ReactNode;
  placeholder?: string;
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
  });

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
    />
  );
}
