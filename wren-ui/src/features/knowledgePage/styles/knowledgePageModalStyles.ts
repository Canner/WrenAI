import { Button, Form, Modal } from 'antd';
import styled from 'styled-components';

export const ReferenceModal = styled(Modal)`
  &.ant-modal {
    max-width: calc(100vw - 64px);
  }

  .ant-modal-content {
    border-radius: 16px;
    padding: 0;
    overflow: hidden;
    border: 1px solid #e5e7eb;
    background: #fff;
    box-shadow: 0 20px 56px rgba(15, 23, 42, 0.12);
  }

  .ant-modal-body {
    padding: 0;
  }
`;

export const ModalPanel = styled.div`
  padding: 28px 28px 24px;
  background: #fff;
`;

export const ModalHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 18px;
  margin-bottom: 20px;
  border-bottom: 1px solid #f1f5f9;
`;

export const ModalTitle = styled.h3`
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #181b2a;
`;

export const ModalIntro = styled.div`
  color: #6b7280;
  font-size: 13px;
  line-height: 1.7;
`;

export const ModalCloseButton = styled.button`
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 0;
  background: transparent;
  color: #313445;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:hover {
    background: #f5f6fb;
  }
`;

export const ModalForm = styled(Form)`
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

  .ant-form-item-required::before {
    color: #ff6b6b !important;
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

export const ModalFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 8px;
  padding-top: 18px;
  border-top: 1px solid #f1f5f9;
`;

export const KnowledgeManageModalPanel = styled(ModalPanel)`
  min-height: 540px;
`;

export const ManageHeaderMain = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

export const ManageHintLink = styled.a`
  color: #6b7280;
  font-size: 13px;
  text-decoration: none;

  &:hover {
    color: #4f46e5;
  }
`;

export const ManageBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

export const ManageCreateCard = styled.button`
  width: 180px;
  height: 98px;
  border: 1px solid rgba(111, 71, 255, 0.28);
  border-radius: 12px;
  background: #fbf9ff;
  color: #6f47ff;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;

  &:hover {
    background: #f5f1ff;
    border-color: rgba(111, 71, 255, 0.45);
  }
`;

export const ManageCreateText = styled.span`
  font-size: 14px;
  font-weight: 600;
`;

export const ManageCreatePlus = styled.span`
  font-size: 28px;
  line-height: 1;
  font-weight: 300;
`;

export const ManageEntryList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const ManageEntryCard = styled.div`
  border: 1px solid #edf0f5;
  border-radius: 10px;
  background: #fff;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

export const ManageEntryMain = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

export const ManageEntryTitle = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const ManageEntryDesc = styled.span`
  font-size: 12px;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 600px;
`;

export const LightButton = styled(Button)`
  &.ant-btn {
    min-width: 88px;
    height: 36px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.88);
    color: #4b5563;
    font-size: 13px;
    font-weight: 600;
    box-shadow: none;
  }

  &.ant-btn:hover {
    background: #fff;
    border-color: rgba(91, 75, 219, 0.16);
    color: #111827;
  }
`;

export const DarkButton = styled(Button)`
  &.ant-btn {
    min-width: 88px;
    height: 40px;
    border: 0;
    border-radius: 8px;
    background: #111827;
    color: #fff;
    font-weight: 500;
    box-shadow: none;
  }

  &.ant-btn[disabled],
  &.ant-btn.ant-btn-loading {
    background: #d1d5db;
    color: #fff;
  }
`;
