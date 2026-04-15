import { Button, Card, Form, Input, Modal, Select, Steps } from 'antd';
import styled from 'styled-components';

export const _PageRoot = styled.div`
  min-height: 100vh;
  padding: 24px 28px 32px;
  background: transparent;
`;

export const _TopBar = styled.div`
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 0 24px;
  border-radius: 12px;
  border: 1px solid var(--nova-outline-soft);
  background: #fff;
`;

export const _WorkspaceShell = styled.div`
  min-height: calc(100vh - 120px);
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 22px;
  margin-top: 22px;
`;

export const _Rail = styled.aside`
  border-radius: 12px;
  border: 1px solid var(--nova-outline-soft);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: #fff;
`;

export const RailTabs = styled.div`
  .ant-radio-group {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
    background: #f3f4f6;
    padding: 2px;
    border-radius: 8px;
    gap: 2px;
  }

  .ant-radio-button-wrapper {
    height: 26px;
    line-height: 26px;
    text-align: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #6b7280;
    font-size: 12px;
    box-shadow: none;
  }

  .ant-radio-button-wrapper:not(:first-child)::before {
    display: none;
  }

  .ant-radio-button-wrapper-checked:not(.ant-radio-button-wrapper-disabled) {
    background: #ffffff;
    color: #111827;
    box-shadow: none;
  }

  .ant-radio-button-wrapper-checked:not(
      .ant-radio-button-wrapper-disabled
    ):focus-within {
    box-shadow: none;
  }
`;

export const KbList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
`;

export const KbCreateButton = styled(Button)`
  &.ant-btn {
    width: 100%;
    height: 30px;
    border-radius: 8px;
    border: 1px dashed rgba(111, 71, 255, 0.35);
    color: #6f47ff;
    background: rgba(111, 71, 255, 0.04);
    box-shadow: none;
    justify-content: flex-start;
    padding-inline: 10px;
    font-size: 12px;
    font-weight: 600;
  }

  &.ant-btn:hover:not([disabled]),
  &.ant-btn:focus-visible:not([disabled]) {
    border-color: rgba(111, 71, 255, 0.56);
    background: rgba(111, 71, 255, 0.08);
    color: #5d3ce0;
  }

  &.ant-btn[disabled] {
    border-color: #e5e7eb;
    color: #9ca3af;
    background: #f8fafc;
  }
`;

export const KbCreateInlineWrap = styled.div`
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid #f1f5f9;
`;

export const KbItem = styled.button<{ $active?: boolean; $disabled?: boolean }>`
  border: 1px solid
    ${(props) =>
      props.$disabled
        ? '#f3f4f6'
        : props.$active
          ? 'rgba(141, 101, 225, 0.18)'
          : 'transparent'};
  background: ${(props) =>
    props.$disabled
      ? '#fafafa'
      : props.$active
        ? 'rgba(141, 101, 225, 0.08)'
        : 'transparent'};
  border-radius: 8px;
  padding: 5px 6px 5px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  cursor: ${(props) => (props.$disabled ? 'not-allowed' : 'pointer')};
  text-align: left;
  color: ${(props) => (props.$disabled ? '#9ca3af' : '#111827')};
  transition: all 0.2s ease;

  &:hover {
    background: ${(props) =>
      props.$disabled
        ? '#fafafa'
        : props.$active
          ? 'rgba(141, 101, 225, 0.08)'
          : '#f7f7fb'};
  }
`;

export const KbItemMeta = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

export const KbItemName = styled.span`
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  color: inherit;
`;

export const CountBadge = styled.span`
  min-width: 17px;
  height: 17px;
  border-radius: 999px;
  background: var(--nova-primary);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 700;
`;

export const _Content = styled.section`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 22px;
`;

export const InfoRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

export const Pill = styled.div`
  height: 26px;
  border-radius: 999px;
  background: #fafbfc;
  border: 1px solid #edf1f5;
  color: #6b7280;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  padding: 0 9px;
  gap: 6px;
  font-size: 12px;
`;

export const _Canvas = styled.div`
  flex: 1;
  min-height: 520px;
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 22px;
  align-items: flex-start;
`;

export const _CardsGrid = styled.div`
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 456px));
  gap: 20px;
  align-content: flex-start;
`;

export const AssetIconBox = styled.div<{ $kind: 'model' | 'view' }>`
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: ${(props) => (props.$kind === 'model' ? '#eef2ff' : '#f5f3ff')};
  color: #5b4bdb;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex: 0 0 auto;
`;

export const _AssetCard = styled(Card)`
  &.ant-card {
    border-radius: 12px;
    border-color: #e5e7eb;
    box-shadow: none;
    overflow: hidden;
  }

  .ant-card-body {
    padding: 0;
  }
`;

export const _AssetHeader = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
`;

export const _AssetBody = styled.div`
  padding: 16px;
`;

export const EmptyStage = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 420px;
  border-radius: 12px;
  background: transparent;
`;

export const EmptyInner = styled.div`
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
`;

export const AssetsLoadingStage = styled.div`
  min-height: 420px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 2px 4px;
`;

export const AssetsLoadingIntro = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #6b7280;
  font-size: 13px;
`;

export const AssetsLoadingGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 456px));
  gap: 20px;
`;

export const AssetsLoadingCard = styled.div`
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #fff;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

export const AssetsLoadingLine = styled.div<{
  $width?: string;
  $height?: number;
  $muted?: boolean;
}>`
  width: ${(props) => props.$width || '100%'};
  height: ${(props) => `${props.$height || 12}px`};
  border-radius: 999px;
  background: ${(props) => (props.$muted ? '#f3f4f6' : '#eceff4')};
`;

export const PrimaryBlackButton = styled.button`
  height: 42px;
  border: 0;
  border-radius: 10px;
  background: #111827;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0 22px;
  cursor: pointer;
`;

export const MetricPill = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  height: 18px;
  border-radius: 999px;
  border: 0;
  background: #f6f7fb;
  color: #8a92a5;
  padding: 0 7px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const MainStage = styled.div`
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

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
    height: 40px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #fff;
    color: #4b5563;
    font-weight: 500;
    box-shadow: none;
  }

  &.ant-btn:hover {
    background: #f9fafb;
    border-color: #d1d5db;
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

export const LibraryStage = styled.div`
  padding: 0;
  min-height: calc(100vh - 24px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: transparent;
`;

export const _LibraryHero = styled.div`
  border-radius: 16px;
  padding: 24px 28px;
  background: #fff;
  border: 1px solid var(--nova-outline-soft);
`;

export const _HeroBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  background: rgba(111, 71, 255, 0.1);
  color: #6f47ff;
  font-size: 13px;
  font-weight: 700;
`;

export const _HeroTop = styled.div`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-top: 16px;
`;

export const _HeroActions = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

export const _HeroAction = styled.button<{ $primary?: boolean }>`
  height: 40px;
  padding: 0 16px;
  border-radius: 8px;
  border: ${(props) =>
    props.$primary ? '0' : '1px solid var(--nova-outline-soft)'};
  background: ${(props) => (props.$primary ? 'var(--nova-primary)' : '#fff')};
  color: ${(props) => (props.$primary ? '#fff' : 'var(--nova-text-primary)')};
  font-size: 14px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  box-shadow: none;
`;

export const _HeroTabsRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 24px;
  flex-wrap: wrap;
`;

export const _HeroTabs = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`;

export const _HeroTab = styled.button<{ $active?: boolean }>`
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(111, 71, 255, 0.22)' : 'rgba(15, 23, 42, 0.08)'};
  background: ${(props) => (props.$active ? '#efe9ff' : '#fff')};
  color: ${(props) => (props.$active ? '#5f3bdf' : '#626a7b')};
  font-size: 13px;
  font-weight: ${(props) => (props.$active ? 700 : 500)};
  cursor: pointer;
`;

export const _FeaturedGrid = styled.div`
  margin-top: 24px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
`;

export const _FeaturedCard = styled.button<{
  $accent: string;
  $active?: boolean;
}>`
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(111, 71, 255, 0.22)' : 'rgba(15, 23, 42, 0.08)'};
  border-radius: 24px;
  background: #fff;
  padding: 16px;
  text-align: left;
  cursor: pointer;
  box-shadow: ${(props) =>
    props.$active
      ? '0 24px 40px rgba(111, 71, 255, 0.14)'
      : '0 18px 34px rgba(15, 23, 42, 0.05)'};
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 22px 40px rgba(111, 71, 255, 0.12);
    border-color: rgba(111, 71, 255, 0.18);
  }
`;

export const _FeaturedCover = styled.div<{ $accent: string }>`
  height: 128px;
  border-radius: 18px;
  margin-bottom: 14px;
  background: ${(props) => props.$accent};
  position: relative;
  overflow: hidden;

  &::after {
    content: '';
    position: absolute;
    inset: auto -20px -34px auto;
    width: 138px;
    height: 138px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.18);
  }
`;

export const WorkbenchGrid = styled.div`
  display: grid;
  grid-template-columns: 252px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  width: 100%;
  gap: 14px;
  align-items: stretch;
  align-content: stretch;
  min-height: calc(100vh - 24px);

  @media (max-width: 1080px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto;
    min-height: 0;
  }
`;

export const SidePanel = styled.div`
  position: sticky;
  top: 0;
  min-height: calc(100vh - 24px);
  height: calc(100vh - 24px);
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: #fff;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;

  @media (max-width: 1080px) {
    position: static;
    min-height: 0;
    height: auto;
  }
`;

export const _SideList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const _SideItem = styled.button<{ $active?: boolean }>`
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(111, 71, 255, 0.18)' : 'rgba(15, 23, 42, 0.04)'};
  border-radius: 16px;
  background: ${(props) =>
    props.$active
      ? 'linear-gradient(180deg, #f4efff 0%, #ffffff 100%)'
      : '#fff'};
  padding: 12px 14px;
  text-align: left;
  cursor: pointer;
`;

export const _MainPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

export const SummaryCard = styled.div`
  border-bottom: 1px solid #ebeef5;
  padding: 0 0 14px;
`;

export const SummaryHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const SummaryTopRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-height: 32px;

  @media (max-width: 980px) {
    flex-direction: column;
    align-items: flex-start;
  }
`;

export const SummaryInfo = styled.div`
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const SummaryDescription = styled.div`
  max-width: none;
  color: #6b7280;
  font-size: 14px;
  line-height: 1.7;
`;

export const SummaryActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  flex-wrap: nowrap;
`;

export const SummaryIconAction = styled.button<{ $primary?: boolean }>`
  width: 32px;
  height: 32px;
  border-radius: 9px;
  border: 1px solid
    ${(props) =>
      props.$primary ? 'rgba(91, 75, 219, 0.18)' : 'rgba(15, 23, 42, 0.08)'};
  background: ${(props) => (props.$primary ? '#f4f0ff' : '#fff')};
  color: ${(props) => (props.$primary ? '#5b4bdb' : '#6b7280')};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    color 0.2s ease;

  &:hover {
    background: ${(props) => (props.$primary ? '#efe9ff' : '#f8fafc')};
    border-color: ${(props) =>
      props.$primary ? 'rgba(91, 75, 219, 0.24)' : 'rgba(15, 23, 42, 0.12)'};
    color: #111827;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.42;
    box-shadow: none;
  }
`;

export const AssetsPanel = styled.div`
  flex: 1;
  min-height: 0;
  background: transparent;
  padding: 0;
`;

export const AssetGalleryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(292px, 1fr));
  gap: 12px;
`;

export const AssetGalleryCard = styled.button<{ $active?: boolean }>`
  width: 100%;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(91, 75, 219, 0.2)' : 'rgba(15, 23, 42, 0.08)'};
  border-radius: 12px;
  background: #fff;
  padding: 0;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  &:hover {
    border-color: rgba(91, 75, 219, 0.14);
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
    transform: translateY(-1px);
  }
`;

export const AssetGalleryHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  background: #fafbfc;
  border-bottom: 1px solid #edf1f5;
`;

export const AssetGalleryTitle = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
`;

export const AssetGalleryLabel = styled.span`
  display: block;
  color: #111827;
  font-size: 11px;
  line-height: 1.4;
  font-weight: 600;
`;

export const AssetGalleryRowMeta = styled.span`
  color: #98a0b3;
  font-size: 10px;
  line-height: 1.4;
`;

export const AssetGalleryBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 8px;
`;

export const AssetGalleryInfoGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

export const AssetGalleryInfoRow = styled.div`
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
`;

export const AssetGalleryInfoSplit = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

export const AssetGalleryInfoLabel = styled.span`
  color: #98a0b3;
  font-size: 11px;
  line-height: 1.5;
`;

export const AssetGalleryInfoValue = styled.span<{ $multiline?: boolean }>`
  min-width: 0;
  color: #374151;
  font-size: 12px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: ${(props) => (props.$multiline ? 'normal' : 'nowrap')};
  display: ${(props) => (props.$multiline ? '-webkit-box' : 'block')};
  -webkit-line-clamp: ${(props) => (props.$multiline ? 2 : 'unset')};
  -webkit-box-orient: vertical;
`;

export const AssetGalleryFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 12px 8px;
`;

export const AssetGalleryChips = styled.div`
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

export const AssetGalleryFooterRight = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  flex-wrap: wrap;
  margin-left: auto;
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

export const WizardSteps = styled(Steps)`
  margin-bottom: 20px;

  &.ant-steps {
    padding: 0 4px;
  }

  .ant-steps-item-title {
    font-size: 14px;
    font-weight: 600;
    color: #374151;
  }

  .ant-steps-item-description {
    display: none;
  }

  .ant-steps-item-process .ant-steps-item-icon,
  .ant-steps-item-finish .ant-steps-item-icon {
    background: var(--nova-primary);
    border-color: var(--nova-primary);
  }

  .ant-steps-item-process .ant-steps-item-title,
  .ant-steps-item-finish .ant-steps-item-title {
    color: var(--nova-primary);
  }

  .ant-steps-item-wait .ant-steps-item-icon {
    border-color: #d1d5db;
    background: #fff;
  }

  .ant-steps-item-wait .ant-steps-item-icon > .ant-steps-icon {
    color: #9ca3af;
  }

  .ant-steps-item-finish .ant-steps-item-tail::after,
  .ant-steps-item-process .ant-steps-item-tail::after {
    background: rgba(123, 85, 232, 0.28);
  }
`;

export const WizardBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 420px;
`;

export const SectionTitle = styled.div`
  margin-bottom: 8px;
  color: #686f82;
  font-size: 12px;
  font-weight: 600;
`;

export const RequiredMark = styled.span`
  color: #ff6b6b;
  margin-right: 4px;
`;

export const SegmentedRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`;

export const SegmentedButton = styled.button<{
  $active?: boolean;
  $disabled?: boolean;
}>`
  height: 36px;
  min-width: 104px;
  padding: 0 16px;
  border-radius: 8px;
  border: 1px solid
    ${(props) => (props.$active ? 'var(--nova-primary)' : '#e5e7eb')};
  background: ${(props) =>
    props.$active ? 'rgba(123, 85, 232, 0.08)' : '#f8fafc'};
  color: ${(props) =>
    props.$disabled
      ? '#9ca3af'
      : props.$active
        ? 'var(--nova-primary)'
        : '#6b7280'};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: ${(props) => (props.$disabled ? 'not-allowed' : 'pointer')};
  box-shadow: none;
  transition: all 0.2s;

  &:disabled {
    pointer-events: none;
  }
`;

export const SourceGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;

  @media (max-width: 1180px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
`;

export const SourceCard = styled.button<{ $active?: boolean }>`
  min-height: 52px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid
    ${(props) => (props.$active ? 'var(--nova-primary)' : '#e5e7eb')};
  background: ${(props) =>
    props.$active ? 'rgba(123, 85, 232, 0.08)' : '#fff'};
  color: ${(props) => (props.$active ? 'var(--nova-primary)' : '#111827')};
  font-size: 13px;
  font-weight: 500;
  display: inline-flex;
  align-items: flex-start;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  flex-direction: column;
  text-align: left;
  transition: all 0.2s;

  &:hover {
    border-color: ${(props) =>
      props.$active ? 'var(--nova-primary)' : '#cbd5e1'};
    background: ${(props) =>
      props.$active ? 'rgba(123, 85, 232, 0.08)' : '#f8fafc'};
  }
`;

export const SourceCardTitle = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  line-height: 1.2;
`;

export const SourceCardMeta = styled.span`
  color: #8a91a5;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
`;

export const SelectGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
`;

export const FieldCluster = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const WizardNote = styled.div`
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: #f8fafc;
  padding: 14px 16px;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.7;
`;

export const WizardFooter = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-top: auto;
  padding-top: 6px;
`;

export const ToggleLabel = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #6b7285;
  font-size: 14px;
  cursor: pointer;
`;

export const ToggleInput = styled.input`
  width: 16px;
  height: 16px;
  accent-color: #6f47ff;
`;

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
  padding: 4px 0 12px;
`;

export const AssetDetailHead = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
`;

export const AssetDetailMetaPills = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
`;

export const AssetDetailMetaPill = styled.span`
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  background: #fff;
  border: 1px solid #e5e7eb;
  color: #4b5563;
  font-size: 13px;
  font-weight: 500;
`;

export const AssetDetailToolbar = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
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
    font-size: 13px;
    font-weight: 600;
    border-bottom: 1px solid #e5e7eb;
    padding-top: 12px;
    padding-bottom: 12px;
  }

  .ant-table-tbody > tr > td {
    font-size: 14px;
    color: #111827;
    vertical-align: top;
    border-bottom: 1px solid #f3f4f6;
    padding-top: 14px;
    padding-bottom: 14px;
  }

  .ant-table-tbody > tr:hover > td {
    background: #f9fafb;
  }
`;

export const AssetDetailEmptyPill = styled(EmptyPill)`
  border-color: var(--nova-outline-soft);
  background: rgba(248, 247, 250, 0.92);
`;

export const AssetDetailTabs = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0;
  border-radius: 0;
  background: transparent;
`;

export const AssetDetailTab = styled.button<{ $active?: boolean }>`
  height: 34px;
  border-radius: 8px;
  border: 1px solid
    ${(props) => (props.$active ? 'rgba(123, 85, 232, 0.22)' : 'transparent')};
  background: ${(props) =>
    props.$active ? 'rgba(123, 85, 232, 0.08)' : 'transparent'};
  color: ${(props) => (props.$active ? 'var(--nova-primary)' : '#6b7280')};
  padding: 0 14px;
  font-size: 13px;
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
  gap: 10px;
  align-items: center;
  justify-content: space-between;
`;

export const AssetDetailFilterPills = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
`;

export const AssetDetailFilterPill = styled.button<{ $active?: boolean }>`
  height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(111, 71, 255, 0.18)' : 'rgba(15, 23, 42, 0.08)'};
  background: ${(props) =>
    props.$active ? 'rgba(111, 71, 255, 0.12)' : 'rgba(248, 247, 250, 0.92)'};
  color: ${(props) => (props.$active ? '#6f47ff' : '#5d6577')};
  font-size: 12px;
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
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--nova-text-secondary);
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
