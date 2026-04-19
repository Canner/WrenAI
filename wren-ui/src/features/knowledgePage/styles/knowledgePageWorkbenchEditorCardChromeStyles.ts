import styled from 'styled-components';

export const WorkbenchEditorCard = styled.button<{ $active?: boolean }>`
  width: 100%;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(91, 75, 219, 0.2)' : 'rgba(15, 23, 42, 0.06)'};
  border-radius: 16px;
  background: ${(props) => (props.$active ? '#fbf8ff' : '#ffffff')};
  padding: 14px;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;

  box-shadow: ${(props) =>
    props.$active ? '0 12px 24px rgba(91, 75, 219, 0.08)' : 'none'};

  &:hover {
    border-color: rgba(91, 75, 219, 0.16);
    background: ${(props) => (props.$active ? '#faf6ff' : '#fcfcfd')};
    box-shadow: 0 10px 20px rgba(15, 23, 42, 0.05);
    transform: translateY(-1px);
  }
`;

export const WorkbenchEditorCardHead = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
`;

export const WorkbenchEditorCardMain = styled.div`
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

export const WorkbenchEditorActionGroup = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
`;

export const WorkbenchMiniIconButton = styled.button<{
  $danger?: boolean;
}>`
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid
    ${(props) =>
      props.$danger ? 'rgba(220, 38, 38, 0.14)' : 'rgba(15, 23, 42, 0.08)'};
  background: #fff;
  color: ${(props) => (props.$danger ? '#dc2626' : '#6b7280')};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:hover {
    border-color: ${(props) =>
      props.$danger ? 'rgba(220, 38, 38, 0.24)' : 'rgba(91, 75, 219, 0.18)'};
    color: ${(props) => (props.$danger ? '#b91c1c' : '#5b4bdb')};
    background: ${(props) =>
      props.$danger ? 'rgba(254, 242, 242, 0.9)' : '#ffffff'};
  }
`;
