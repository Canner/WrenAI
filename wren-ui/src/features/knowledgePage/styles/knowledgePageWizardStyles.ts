import { Steps } from 'antd';
import styled from 'styled-components';

export const WizardSteps = styled(Steps)`
  margin-bottom: 20px;

  &.ant-steps {
    padding: 0 4px;
  }

  .ant-steps-item-title {
    font-size: 14px;
    font-weight: 600;
    color: #374151;
  }

  .ant-steps-item-description {
    display: none;
  }

  .ant-steps-item-process .ant-steps-item-icon,
  .ant-steps-item-finish .ant-steps-item-icon {
    background: var(--nova-primary);
    border-color: var(--nova-primary);
  }

  .ant-steps-item-process .ant-steps-item-title,
  .ant-steps-item-finish .ant-steps-item-title {
    color: var(--nova-primary);
  }

  .ant-steps-item-wait .ant-steps-item-icon {
    border-color: #d1d5db;
    background: #fff;
  }

  .ant-steps-item-wait .ant-steps-item-icon > .ant-steps-icon {
    color: #9ca3af;
  }

  .ant-steps-item-finish .ant-steps-item-tail::after,
  .ant-steps-item-process .ant-steps-item-tail::after {
    background: rgba(123, 85, 232, 0.28);
  }
`;

export const WizardBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 420px;
`;

export const SectionTitle = styled.div`
  margin-bottom: 8px;
  color: #686f82;
  font-size: 12px;
  font-weight: 600;
`;

export const RequiredMark = styled.span`
  color: #ff6b6b;
  margin-right: 4px;
`;

export const SegmentedRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`;

export const SegmentedButton = styled.button<{
  $active?: boolean;
  $disabled?: boolean;
}>`
  height: 36px;
  min-width: 104px;
  padding: 0 16px;
  border-radius: 8px;
  border: 1px solid
    ${(props) => (props.$active ? 'var(--nova-primary)' : '#e5e7eb')};
  background: ${(props) =>
    props.$active ? 'rgba(123, 85, 232, 0.08)' : '#f8fafc'};
  color: ${(props) =>
    props.$disabled
      ? '#9ca3af'
      : props.$active
        ? 'var(--nova-primary)'
        : '#6b7280'};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: ${(props) => (props.$disabled ? 'not-allowed' : 'pointer')};
  box-shadow: none;
  transition: all 0.2s;

  &:disabled {
    pointer-events: none;
  }
`;

export const SourceGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;

  @media (max-width: 1180px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
`;

export const SourceCard = styled.button<{ $active?: boolean }>`
  min-height: 58px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(91, 75, 219, 0.24)' : 'rgba(15, 23, 42, 0.08)'};
  background: ${(props) =>
    props.$active
      ? 'linear-gradient(180deg, #f6f1ff 0%, #ffffff 100%)'
      : '#fff'};
  color: ${(props) => (props.$active ? 'var(--nova-primary)' : '#111827')};
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: flex-start;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  flex-direction: column;
  text-align: left;
  transition: all 0.2s;

  &:hover {
    border-color: ${(props) =>
      props.$active ? 'rgba(91, 75, 219, 0.24)' : 'rgba(91, 75, 219, 0.14)'};
    background: ${(props) =>
      props.$active
        ? 'linear-gradient(180deg, #f6f1ff 0%, #ffffff 100%)'
        : '#fafbfd'};
  }
`;

export const SourceCardTitle = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  line-height: 1.2;
`;

export const SourceCardMeta = styled.span`
  color: #8a91a5;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
`;

export const SelectGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
`;

export const FieldCluster = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const WizardNote = styled.div`
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: #f8fafc;
  padding: 14px 16px;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.7;
`;

export const WizardFooter = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-top: auto;
  padding-top: 6px;
`;

export const ToggleLabel = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #6b7285;
  font-size: 14px;
  cursor: pointer;
`;

export const ToggleInput = styled.input`
  width: 16px;
  height: 16px;
  accent-color: #6f47ff;
`;
