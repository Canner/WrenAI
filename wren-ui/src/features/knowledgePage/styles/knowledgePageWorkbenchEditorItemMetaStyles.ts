import styled from 'styled-components';

export const WorkbenchEditorMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

export const WorkbenchEditorMetaText = styled.span`
  color: var(--nova-text-secondary);
  font-size: 11px;
  line-height: 1.4;
`;

export const WorkbenchEditorStatusChip = styled.span<{
  $tone?: 'default' | 'accent' | 'muted';
}>`
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  background: ${(props) =>
    props.$tone === 'accent'
      ? 'rgba(91, 75, 219, 0.10)'
      : props.$tone === 'muted'
        ? '#f3f4f6'
        : '#f6f7fb'};
  color: ${(props) =>
    props.$tone === 'accent' ? '#5b4bdb' : 'var(--nova-text-secondary)'};
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
`;

export const WorkbenchEditorTitle = styled.div`
  font-size: 14px;
  font-weight: 650;
  color: var(--nova-text-primary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

export const WorkbenchEditorDesc = styled.div`
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--nova-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;
