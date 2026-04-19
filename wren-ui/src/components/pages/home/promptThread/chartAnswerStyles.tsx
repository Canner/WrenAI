import { Button, Skeleton } from 'antd';
import styled from 'styled-components';

export const StyledSkeleton = styled(Skeleton)`
  padding: 16px;
  .ant-skeleton-paragraph {
    margin-bottom: 0;
  }
`;

export const ChartWrapper = styled.div`
  position: relative;
  padding-top: 0;
  transition: padding-top 0.2s ease-out;
  &.isEditMode {
    padding-top: 72px;
  }
`;

export const Toolbar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: var(--gray-3);
  padding: 8px 16px;
  position: absolute;
  top: -72px;
  left: 0;
  right: 0;
  transition: top 0.2s ease-out;
  &.isEditMode {
    top: 0;
  }
`;

export const ResultActionButton = styled(Button)`
  && {
    height: 34px;
    border-radius: 10px;
    padding-inline: 12px;
    font-weight: 500;
  }
`;
