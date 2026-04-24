import styled from 'styled-components';

export const AssistantColumn = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

export const AssistantIntroCard = styled.div`
  border: 1px solid rgba(109, 74, 255, 0.12);
  border-radius: 20px;
  background: linear-gradient(180deg, #fcfaff 0%, #ffffff 100%);
  box-shadow: 0 16px 36px rgba(109, 74, 255, 0.08);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

export const AssistantSectionCard = styled.div`
  border: 1px solid #e5e7eb;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

export const AssistantPillRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`;

export const AssistantPill = styled.div<{
  $tone?: 'default' | 'success' | 'warning' | 'accent';
}>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  color: ${(props) => {
    switch (props.$tone) {
      case 'success':
        return '#166534';
      case 'warning':
        return '#b45309';
      case 'accent':
        return '#6d4aff';
      default:
        return '#475467';
    }
  }};
  background: ${(props) => {
    switch (props.$tone) {
      case 'success':
        return 'rgba(22, 101, 52, 0.1)';
      case 'warning':
        return 'rgba(180, 83, 9, 0.12)';
      case 'accent':
        return 'rgba(109, 74, 255, 0.12)';
      default:
        return '#f4f4f5';
    }
  }};
`;

export const AssistantMutedText = styled.div`
  color: #667085;
  font-size: 13px;
  line-height: 1.6;
`;

export const AssistantFooterBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

export const AssistantSectionHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
`;

export const AssistantDocLink = styled.a`
  font-size: 13px;
  font-weight: 600;
  color: #6d4aff;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

export const AssistantPromptChip = styled.button`
  border: 1px solid rgba(109, 74, 255, 0.16);
  background: rgba(109, 74, 255, 0.06);
  color: #6d4aff;
  padding: 8px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  cursor: default;
`;
