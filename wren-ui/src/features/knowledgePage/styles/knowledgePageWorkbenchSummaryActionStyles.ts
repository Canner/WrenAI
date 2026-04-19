import styled from 'styled-components';

export const SummaryActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  flex-wrap: wrap;
`;

export const SummaryIconAction = styled.button<{ $primary?: boolean }>`
  width: 36px;
  height: 36px;
  border-radius: 12px;
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
