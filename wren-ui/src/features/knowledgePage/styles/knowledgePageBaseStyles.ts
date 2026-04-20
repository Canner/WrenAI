import { Button, Card } from 'antd';
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
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

export const KbCreateButton = styled(Button)`
  &.ant-btn {
    width: 100%;
    height: 34px;
    border-radius: 10px;
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
  width: 100%;
  min-width: 0;
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
  overflow: hidden;

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
  height: 36px;
  border: 0;
  border-radius: 10px;
  background: #111827;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  cursor: pointer;

  &:disabled {
    cursor: not-allowed;
    background: #d1d5db;
    color: rgba(255, 255, 255, 0.92);
  }
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
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 18px;
`;
