import styled from 'styled-components';

export const WorkbenchSectionPanel = styled.div`
  border-radius: 20px;
  border: 1px solid var(--nova-outline-soft);
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.04);
  padding: 20px 22px;
`;

export const WorkbenchSectionHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
`;

export const WorkbenchSectionTitle = styled.div`
  font-size: 18px;
  font-weight: 700;
  color: var(--nova-text-primary);
`;

export const WorkbenchSectionDesc = styled.div`
  margin-top: 6px;
  color: var(--nova-text-secondary);
  font-size: 13px;
  line-height: 1.6;
`;

export const WorkbenchPanelActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

export const WorkbenchProcessGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;

  @media (max-width: 980px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

export const WorkbenchProcessCard = styled.div<{
  $active?: boolean;
  $done?: boolean;
}>`
  border-radius: 16px;
  border: 1px solid
    ${(props) =>
      props.$active || props.$done
        ? 'rgba(91, 75, 219, 0.18)'
        : 'rgba(15, 23, 42, 0.08)'};
  background: ${(props) =>
    props.$active
      ? 'linear-gradient(180deg, #f7f2ff 0%, #ffffff 100%)'
      : props.$done
        ? 'linear-gradient(180deg, #faf7ff 0%, #ffffff 100%)'
        : '#ffffff'};
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const WorkbenchProcessHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

export const WorkbenchProcessBadge = styled.span<{
  $active?: boolean;
  $done?: boolean;
}>`
  width: 24px;
  height: 24px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: ${(props) =>
    props.$active || props.$done ? '#5b4bdb' : 'var(--nova-text-secondary)'};
  background: ${(props) =>
    props.$active || props.$done
      ? 'rgba(91, 75, 219, 0.12)'
      : 'rgba(15, 23, 42, 0.05)'};
`;

export const WorkbenchProcessTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: var(--nova-text-primary);
`;

export const WorkbenchProcessMeta = styled.div`
  font-size: 12px;
  line-height: 1.5;
  color: var(--nova-text-secondary);
`;

export const WorkbenchStatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
`;

export const WorkbenchColumnGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;

  @media (max-width: 980px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;
