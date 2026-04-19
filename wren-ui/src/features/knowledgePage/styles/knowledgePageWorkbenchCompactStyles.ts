import styled from 'styled-components';

export const WorkbenchCompactPanel = styled.div`
  border-radius: 18px;
  border: 1px solid var(--nova-outline-soft);
  background: linear-gradient(
    180deg,
    rgba(250, 250, 253, 0.94) 0%,
    rgba(255, 255, 255, 0.96) 100%
  );
  padding: 16px;
`;

export const WorkbenchCompactPanelTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: var(--nova-text-primary);
  margin-bottom: 10px;
`;

export const WorkbenchCompactList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const WorkbenchCompactChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
`;

export const WorkbenchCompactChip = styled.span<{
  $tone?: 'default' | 'accent';
}>`
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: ${(props) =>
    props.$tone === 'accent' ? 'rgba(91, 75, 219, 0.08)' : '#f3f5f8'};
  color: ${(props) => (props.$tone === 'accent' ? '#5b4bdb' : '#6b7280')};
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
`;

export const WorkbenchCompactItem = styled.div`
  border-radius: 14px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  background: rgba(251, 252, 254, 0.96);
  padding: 11px 12px;

  &[type='button'] {
    width: 100%;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.18s ease,
      background 0.18s ease,
      transform 0.18s ease;

    &:hover {
      border-color: rgba(91, 75, 219, 0.14);
      background: #ffffff;
      transform: translateY(-1px);
    }
  }
`;

export const WorkbenchCompactItemTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: var(--nova-text-primary);
  line-height: 1.4;
`;

export const WorkbenchCompactItemMeta = styled.div`
  margin-top: 4px;
  font-size: 12px;
  color: var(--nova-text-secondary);
  line-height: 1.45;
`;
