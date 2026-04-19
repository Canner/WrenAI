import styled from 'styled-components';

export const WorkbenchHelperGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;

  @media (max-width: 980px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

export const WorkbenchStatCard = styled.div`
  border-radius: 18px;
  border: 1px solid var(--nova-outline-soft);
  background: linear-gradient(
    180deg,
    rgba(248, 246, 251, 0.92) 0%,
    rgba(255, 255, 255, 0.98) 100%
  );
  padding: 14px 16px;
`;

export const WorkbenchStatLabel = styled.div`
  color: var(--nova-text-secondary);
  font-size: 12px;
  margin-bottom: 8px;
`;

export const WorkbenchStatValue = styled.div`
  color: var(--nova-text-primary);
  font-size: clamp(20px, 2vw, 24px);
  line-height: 1.15;
  font-weight: 700;
  overflow-wrap: anywhere;
  word-break: break-word;
`;

export const WorkbenchEmpty = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  justify-content: center;
  min-height: 240px;
  text-align: center;
  color: var(--nova-text-secondary);
`;
