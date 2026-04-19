import { Input, Select } from 'antd';
import styled from 'styled-components';
import { ModalForm, ModalPanel } from './knowledgePageModalStyles';

export const TitleGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

export const DetailIconButton = styled.button`
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fff;
  color: #62697a;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:hover {
    color: #6f47ff;
    border-color: rgba(111, 71, 255, 0.2);
  }
`;

export const _DetailTableWrap = styled.div`
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 16px;
  overflow: hidden;
  background: #fff;

  .ant-table-thead > tr > th {
    background: #f7f8fb;
    color: #6d7285;
    font-size: 13px;
    font-weight: 700;
  }

  .ant-table-tbody > tr > td {
    font-size: 14px;
    color: #2e3240;
    vertical-align: top;
  }
`;

export const EmptyPill = styled.span`
  min-width: 68px;
  height: 30px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fafbfe;
  color: #666d80;
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

export const AssetDetailModalBody = styled.div`
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 0;

  @media (max-width: 1080px) {
    grid-template-columns: 1fr;
  }
`;

export const AssetDetailSidebar = styled.aside`
  padding: 8px 20px 8px 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 720px;
  border-right: 1px solid #f1f5f9;

  @media (max-width: 1080px) {
    min-height: auto;
    padding: 0 0 18px;
    border-right: 0;
    border-bottom: 1px solid #f1f5f9;
  }
`;

export const AssetDetailSidebarList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow: auto;
`;

export const AssetDetailSidebarItem = styled.button<{ $active?: boolean }>`
  width: 100%;
  border-radius: 8px;
  border: 1px solid
    ${(props) => (props.$active ? 'rgba(123, 85, 232, 0.22)' : 'transparent')};
  background: ${(props) =>
    props.$active ? 'rgba(123, 85, 232, 0.07)' : 'transparent'};
  padding: 12px;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: #f8fafc;
  }
`;

export const AssetDetailMain = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-left: 24px;

  @media (max-width: 1080px) {
    padding-left: 0;
  }
`;

export const AssetDetailHero = styled.div`
  background: #fff;
  padding: 0 0 10px;
`;

export const AssetDetailHead = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
`;

export const AssetDetailMetaPills = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
`;

export const AssetDetailMetaPill = styled.span`
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 7px;
  border-radius: 6px;
  background: #fff;
  border: 1px solid #e5e7eb;
  color: #4b5563;
  font-size: 11px;
  font-weight: 500;
`;

export const AssetDetailToolbar = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;

  .ant-btn {
    height: 32px;
    padding-inline: 12px;
    border-radius: 8px;
    font-size: 12px;
    box-shadow: none;
  }
`;

export const AssetDetailIconButton = styled(DetailIconButton)`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #fff;
`;

export const AssetDetailTableWrap = styled.div`
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;

  .ant-table-thead > tr > th {
    background: #f8fafc;
    color: #4b5563;
    font-size: 11px;
    font-weight: 600;
    border-bottom: 1px solid #e5e7eb;
    padding-top: 7px;
    padding-bottom: 7px;
  }

  .ant-table-tbody > tr > td {
    font-size: 12px;
    color: #111827;
    vertical-align: top;
    border-bottom: 1px solid #f3f4f6;
    padding-top: 7px;
    padding-bottom: 7px;
    line-height: 1.35;
  }

  .ant-table-tbody > tr:hover > td {
    background: #f9fafb;
  }

  .ant-tag {
    padding: 0 6px;
    border-radius: 999px;
  }
`;

export const AssetDetailEmptyPill = styled(EmptyPill)`
  border-color: var(--nova-outline-soft);
  background: rgba(248, 247, 250, 0.92);
`;

export const AssetDetailTabs = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0;
  border-radius: 0;
  background: transparent;
`;

export const AssetDetailTab = styled.button<{ $active?: boolean }>`
  height: 30px;
  border-radius: 8px;
  border: 1px solid
    ${(props) => (props.$active ? 'rgba(123, 85, 232, 0.22)' : 'transparent')};
  background: ${(props) =>
    props.$active ? 'rgba(123, 85, 232, 0.08)' : 'transparent'};
  color: ${(props) => (props.$active ? 'var(--nova-primary)' : '#6b7280')};
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: none;
  transition: all 0.2s;
`;

export const AssetDetailSummaryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
`;

export const AssetDetailSummaryCard = styled.div`
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: #fff;
  padding: 14px 16px;
`;

export const AssetDetailSection = styled.div`
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #fff;
  padding: 16px 18px;
`;

export const AssetDetailFilterRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;

  .ant-input-search {
    flex: 1 1 280px;
    max-width: 360px;
  }

  .ant-input-affix-wrapper {
    min-height: 32px;
    padding-top: 4px;
    padding-bottom: 4px;
    border-radius: 10px;
  }

  .ant-input-search-button {
    height: 32px;
    border-radius: 0 10px 10px 0;
  }
`;

export const AssetDetailFilterPills = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
`;

export const AssetDetailFilterPill = styled.button<{ $active?: boolean }>`
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(111, 71, 255, 0.18)' : 'rgba(15, 23, 42, 0.08)'};
  background: ${(props) =>
    props.$active ? 'rgba(111, 71, 255, 0.12)' : 'rgba(248, 247, 250, 0.92)'};
  color: ${(props) => (props.$active ? '#6f47ff' : '#5d6577')};
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
`;

export const AssetDetailSqlPreview = styled.pre`
  margin: 0;
  padding: 14px 16px;
  border-radius: 16px;
  background: #131722;
  color: #d7def0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.7;
  overflow: auto;
`;

export const AssetDetailQuestionList = styled.ul`
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--nova-text-secondary);
  font-size: 12px;
  line-height: 1.55;
`;

export const DetailForm = styled(ModalForm)`
  .ant-input-textarea .ant-input {
    min-height: 136px;
  }

  .ant-form-item {
    margin-bottom: 24px;
  }

  .ant-form-item-label > label {
    font-size: 14px;
    color: #656c7e;
  }
`;

export const LargeTextArea = styled(Input.TextArea)`
  &.ant-input {
    min-height: 300px;
    border-radius: 12px !important;
    border-color: rgba(31, 35, 50, 0.1) !important;
    background: #fff !important;
    resize: none;
  }
`;

export const BackTitle = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 12px;
`;

export const BackButton = styled.button`
  width: 32px;
  height: 32px;
  border-radius: 10px;
  border: 0;
  background: transparent;
  color: #24283a;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:hover {
    background: #f4f6fb;
  }
`;

export const DetailModalPanel = styled(ModalPanel)`
  min-height: 620px;
  padding: 28px 30px 24px;
`;

export const DetailFormBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

export const ScopeSelect = styled(Select)`
  &.ant-select {
    min-width: 200px;
  }

  .ant-select-selector {
    border-radius: 10px !important;
  }
`;

export const CodeEditorShell = styled.div`
  position: relative;
  border: 1px solid rgba(31, 35, 50, 0.26);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4);
`;

export const CodeEditorGutter = styled.div`
  position: absolute;
  inset: 0 auto 0 0;
  width: 40px;
  border-right: 1px solid rgba(31, 35, 50, 0.08);
  background: linear-gradient(180deg, #fafbff 0%, #f3f5fb 100%);
  color: #5b6cb2;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  font-weight: 700;
  padding-top: 12px;
  text-align: center;
  pointer-events: none;
`;

export const CodeEditorTextArea = styled(Input.TextArea)`
  &.ant-input {
    min-height: 320px;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    resize: none;
    padding: 12px 14px 12px 54px !important;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    line-height: 1.7;
  }
`;
