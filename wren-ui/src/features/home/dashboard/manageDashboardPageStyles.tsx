import { Button, Card } from 'antd';
import styled from 'styled-components';

export const DashboardWorkbench = styled.div`
  flex: 1;
  width: 100%;
  margin: 0;
  display: grid;
  grid-template-columns: 304px minmax(0, 1fr);
  grid-auto-rows: minmax(0, 1fr);
  gap: 18px;
  align-items: stretch;
  min-height: 100%;
  height: 100%;

  @media (max-width: 1080px) {
    grid-template-columns: 1fr;
    grid-auto-rows: auto;
    min-height: 0;
    height: auto;
  }
`;

export const DashboardRail = styled.aside`
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
`;

export const DashboardRailCard = styled(Card)`
  &.ant-card {
    height: 100%;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    border-radius: 18px;
    border: 1px solid var(--nova-outline-soft);
    background: rgba(255, 255, 255, 0.96);
    box-shadow: var(--nova-shadow-soft);
    overflow: hidden;
  }

  @media (max-width: 1080px) {
    &.ant-card {
      min-height: auto;
    }
  }

  .ant-card-body {
    flex: 1;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 100%;
    height: 100%;
  }
`;

export const DashboardRailSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
`;

export const DashboardRailSectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

export const DashboardRailSectionTitle = styled.span`
  font-size: 12px;
  line-height: 1.4;
  font-weight: 600;
  color: var(--nova-text-secondary);
`;

export const DashboardRailSectionCount = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: #f3f4f6;
  color: var(--nova-text-secondary);
  font-size: 11px;
  line-height: 1;
  font-weight: 600;
`;

export const DashboardRailList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  overflow: auto;
`;

export const DashboardRailItem = styled.button<{ $active?: boolean }>`
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 6px 5px 8px;
  border-radius: 8px;
  border: 1px solid
    ${(props) => (props.$active ? 'rgba(141, 101, 225, 0.2)' : 'transparent')};
  background: ${(props) =>
    props.$active ? 'rgba(141, 101, 225, 0.08)' : 'transparent'};
  text-align: left;
  cursor: pointer;
  transition: all 0.18s ease;

  &:hover {
    background: ${(props) =>
      props.$active ? 'rgba(141, 101, 225, 0.1)' : '#f7f7fb'};
  }
`;

export const DashboardRailItemBody = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

export const DashboardRailTitle = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
  line-height: 1.35;
  font-weight: 600;
  color: var(--nova-text-primary);

  > span,
  .ant-typography {
    min-width: 0;
  }
`;

export const DashboardRailMeta = styled.span`
  display: block;
  min-width: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--nova-text-secondary);
`;

export const DashboardRailItemMenuButton = styled(Button)`
  &.ant-btn {
    width: 24px;
    height: 24px;
    min-width: 24px;
    padding: 0;
    border: none;
    box-shadow: none;
    color: var(--nova-text-secondary);
  }
`;

export const DashboardRailCreateButton = styled(Button)`
  &.ant-btn {
    width: 100%;
    height: 32px;
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
`;

export const DashboardDetailCard = styled.div`
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  background: linear-gradient(180deg, #fcfcff 0%, #f8f8fe 100%);
  padding: 10px;

  .ant-descriptions {
    font-size: 12px;
  }

  .ant-descriptions-item {
    padding-bottom: 8px;
  }

  .ant-descriptions-item-label {
    color: var(--nova-text-secondary);
    padding-right: 10px;
  }
`;

export const DashboardDetailHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
`;

export const DashboardDetailMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
`;

export const DashboardDetailName = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

export const DashboardDetailHint = styled.span`
  font-size: 12px;
  line-height: 1.4;
  color: var(--nova-text-secondary);
`;

export const DashboardDetailActions = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-top: 10px;

  @media (max-width: 1080px) {
    grid-template-columns: 1fr;
  }
`;

export const DashboardStage = styled.section`
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
`;

export const DashboardStageCanvas = styled.div<{ $empty?: boolean }>`
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: ${(props) => (props.$empty ? 'max(620px, 100dvh)' : '100dvh')};
  border-radius: 18px;
  border: 1px solid var(--nova-outline-soft);
  background: rgba(255, 255, 255, 0.98);
  box-shadow: var(--nova-shadow-soft);
  overflow: hidden;

  @media (max-width: 1080px) {
    min-height: ${(props) => (props.$empty ? '620px' : '0')};
  }
`;

export const WorkbenchActionButton = styled(Button)`
  && {
    height: 34px;
    border-radius: 10px;
    padding-inline: 12px;
    font-weight: 500;
    box-shadow: none;
  }
`;

export const WorkbenchPrimaryActionButton = styled(WorkbenchActionButton)`
  && {
    border-color: transparent;
    box-shadow: 0 8px 18px rgba(111, 71, 255, 0.14);
  }
`;
