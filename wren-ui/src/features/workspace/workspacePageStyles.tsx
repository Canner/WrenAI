import { Input } from 'antd';
import styled from 'styled-components';

export const FlatSearchInput = styled(Input.Search)`
  &&.ant-input-search .ant-input-group .ant-input-affix-wrapper,
  &&.ant-input-affix-wrapper {
    border-radius: 10px;
    border-color: #e5e9f3;
    box-shadow: none;
  }

  &&.ant-input-search .ant-input-group .ant-input-affix-wrapper .ant-input,
  &&.ant-input-affix-wrapper .ant-input {
    border: 0 !important;
    box-shadow: none !important;
    background: transparent !important;
  }
`;
