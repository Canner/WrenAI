import styled from 'styled-components';

export const WorkbenchEditorGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 16px;

  @media (max-width: 1120px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

export const WorkbenchEditorRail = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const WorkbenchEditorCardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  align-items: stretch;
`;

export const WorkbenchRailTop = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const WorkbenchListCount = styled.div`
  color: var(--nova-text-secondary);
  font-size: 12px;
`;

export const WorkbenchFilterRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

export const WorkbenchFilterChip = styled.button<{ $active?: boolean }>`
  height: 28px;
  border-radius: 999px;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(91, 75, 219, 0.18)' : 'rgba(15, 23, 42, 0.08)'};
  background: ${(props) => (props.$active ? '#f4efff' : '#fff')};
  color: ${(props) => (props.$active ? '#5b4bdb' : '#6b7280')};
  font-size: 12px;
  font-weight: ${(props) => (props.$active ? 700 : 500)};
  padding: 0 10px;
  cursor: pointer;
`;
