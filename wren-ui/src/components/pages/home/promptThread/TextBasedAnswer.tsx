import { Skeleton } from 'antd';
import styled from 'styled-components';

const StyledSkeleton = styled(Skeleton)`
  padding: 16px;
  .ant-skeleton-paragraph {
    margin-bottom: 0;
  }
`;

export default function TextBasedAnswer() {
  return (
    <StyledSkeleton
      active
      loading={false}
      paragraph={{ rows: 4 }}
      title={false}
    >
      <div className="text-md gray-10 p-3 pr-10 pt-6">Coming soon</div>
    </StyledSkeleton>
  );
}
