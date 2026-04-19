import styled from 'styled-components';

export const WorkbenchCreateCard = styled.button`
  width: 100%;
  min-height: 126px;
  border: 1px dashed rgba(91, 75, 219, 0.22);
  border-radius: 16px;
  background: linear-gradient(180deg, #fcfbff 0%, #ffffff 100%);
  padding: 18px 16px;
  text-align: left;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;

  &:hover {
    border-color: rgba(91, 75, 219, 0.34);
    background: linear-gradient(180deg, #faf7ff 0%, #ffffff 100%);
    box-shadow: 0 12px 24px rgba(91, 75, 219, 0.08);
    transform: translateY(-1px);
  }
`;

export const WorkbenchCreateCardTop = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

export const WorkbenchCreateCardIcon = styled.span`
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: rgba(91, 75, 219, 0.1);
  color: #5b4bdb;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
`;

export const WorkbenchCreateCardTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: #1f2937;
  line-height: 1.4;
`;

export const WorkbenchCreateCardMeta = styled.div`
  font-size: 12px;
  color: var(--nova-text-secondary);
  line-height: 1.5;
`;
