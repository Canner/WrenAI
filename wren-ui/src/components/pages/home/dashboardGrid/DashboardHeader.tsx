import { Button } from 'antd';
import styled from 'styled-components';

interface Props {
  title: string;
  onBrowseMetrics?: () => void;
}

const StyledHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 49px;
  padding: 8px 16px;
  background-color: white;
  border-bottom: 1px solid var(--gray-4);
`;

export default function DashboardHeader(props: Props) {
  const { title, onBrowseMetrics } = props;
  return (
    <StyledHeader>
      <div />
      {/* <span className="text-medium text-md gray-9">{title}</span>
      {onBrowseMetrics && (
        <Button onClick={onBrowseMetrics}>Browse Metrics</Button>
      )} */}
      <div>Schedule refresh time: Daily 10AM</div>
    </StyledHeader>
  );
}
