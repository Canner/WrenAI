import { Button } from 'antd';
import styled from 'styled-components';

export const DashboardWorkbench = styled.div`
  width: min(100%, 1480px);
  margin: 0 auto;
  display: grid;
  grid-template-columns: 312px minmax(0, 1fr);
  gap: 18px;
  align-items: start;

  @media (max-width: 1080px) {
    grid-template-columns: 1fr;
  }
`;

export const DashboardRail = styled.aside`
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

export const DashboardRailCard = styled.section`
  border-radius: 18px;
  border: 1px solid var(--nova-outline-soft);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: var(--nova-shadow-soft);
  padding: 18px;
`;

export const DashboardRailList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
`;

export const DashboardRailItem = styled.button<{ $active?: boolean }>`
  width: 100%;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(141, 101, 225, 0.18)' : 'var(--nova-outline-soft)'};
  border-radius: 16px;
  background: ${(props) =>
    props.$active
      ? 'linear-gradient(180deg, rgba(238, 233, 252, 0.92) 0%, rgba(255, 255, 255, 0.98) 100%)'
      : 'rgba(255, 255, 255, 0.94)'};
  padding: 13px 14px;
  text-align: left;
  cursor: pointer;
  transition: all 0.18s ease;

  &:hover {
    border-color: rgba(141, 101, 225, 0.18);
    transform: translateY(-1px);
    box-shadow: 0 14px 24px -18px rgba(31, 35, 50, 0.26);
  }
`;

export const DashboardRailTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: var(--nova-text-primary);
`;

export const DashboardRailMeta = styled.div`
  margin-top: 6px;
  font-size: 12px;
  color: var(--nova-text-secondary);
`;

export const DashboardStage = styled.section`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

export const DashboardStageHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-radius: 18px;
  border: 1px solid var(--nova-outline-soft);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: var(--nova-shadow-soft);

  @media (max-width: 960px) {
    flex-direction: column;
  }
`;

export const DashboardStageHeading = styled.div`
  min-width: 0;
`;

export const DashboardStageTitle = styled.h1`
  margin: 0;
  font-size: 30px;
  line-height: 1.2;
  font-weight: 700;
  color: var(--nova-text-primary);
`;

export const DashboardStageMeta = styled.div`
  margin-top: 6px;
  font-size: 13px;
  color: var(--nova-text-secondary);
`;

export const DashboardStageCanvas = styled.div<{ $empty?: boolean }>`
  min-width: 0;
  min-height: ${(props) => (props.$empty ? '560px' : '0')};
  border-radius: 18px;
  border: 1px solid var(--nova-outline-soft);
  background: rgba(255, 255, 255, 0.98);
  box-shadow: var(--nova-shadow-soft);
  overflow: auto;
`;

export const DashboardQuickActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
`;

export const WorkbenchActionButton = styled(Button)`
  && {
    height: 36px;
    border-radius: 10px;
    padding-inline: 14px;
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

export const DashboardStageActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;

  @media (max-width: 960px) {
    justify-content: flex-start;
  }
`;

export const DashboardDetailStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
`;

export const DashboardDetailRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: var(--nova-text-secondary);
`;

export const DashboardPill = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(141, 101, 225, 0.12);
  color: var(--nova-primary);
  font-size: 12px;
  font-weight: 600;
`;
