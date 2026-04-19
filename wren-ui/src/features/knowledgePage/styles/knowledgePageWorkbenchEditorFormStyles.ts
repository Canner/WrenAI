import { Button, Form } from 'antd';
import styled from 'styled-components';

export const WorkbenchEditorPanel = styled.div`
  border-radius: 18px;
  border: 1px solid var(--nova-outline-soft);
  background: rgba(255, 255, 255, 0.9);
  padding: 18px;
`;

export const WorkbenchEditorForm = styled(Form)`
  .ant-form-item {
    margin-bottom: 16px;
  }

  .ant-form-item-label {
    padding-bottom: 6px;
  }

  .ant-form-item-label > label {
    font-size: 12px;
    font-weight: 600;
    color: #686f82;
  }

  .ant-input,
  .ant-input-affix-wrapper,
  .ant-select-selector {
    border-radius: 10px !important;
    border-color: rgba(15, 23, 42, 0.1) !important;
    border-style: solid !important;
    border-width: 1px !important;
    background: rgba(255, 255, 255, 0.96) !important;
    box-shadow: none !important;
  }

  .ant-input,
  .ant-input-affix-wrapper {
    padding: 8px 12px;
  }

  .ant-input {
    min-height: 40px;
  }

  .ant-input-textarea .ant-input {
    min-height: 108px;
    padding-top: 10px;
  }

  .ant-select-single:not(.ant-select-customize-input) .ant-select-selector {
    height: 40px;
    padding: 0 12px;
    display: flex;
    align-items: center;
  }

  .ant-select-selection-search-input,
  .ant-select-selection-item,
  .ant-select-selection-placeholder {
    height: 40px !important;
    line-height: 40px !important;
  }
`;

export const WorkbenchEditorActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
`;

export const WorkbenchDraftBanner = styled.div`
  margin-top: 12px;
  border-radius: 12px;
  border: 1px solid rgba(91, 75, 219, 0.16);
  background: rgba(247, 244, 255, 0.9);
  color: #5b4bdb;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

export const WorkbenchKeyboardHint = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--nova-text-secondary);
  font-size: 11px;
  line-height: 1.4;
`;

export const PurpleButton = styled(Button)`
  &.ant-btn {
    min-width: 88px;
    height: 40px;
    border: 0;
    border-radius: 8px;
    background: var(--nova-primary);
    color: #fff;
    font-weight: 500;
    box-shadow: none;
  }

  &.ant-btn:hover {
    background: #5b4bdb;
  }

  &.ant-btn[disabled],
  &.ant-btn.ant-btn-loading {
    background: #d1d5db;
    color: #fff;
  }
`;
