import { Typography, Timeline } from 'antd';
import { Error } from '@/apollo/client/graphql/__types__';
import CloseCircleFilled from '@ant-design/icons/CloseCircleFilled';

export interface Props {
  children: React.ReactNode;
  error?: Error & { invalidSql?: string };
}

export default function ErrorBoundary({ children, error }: Props) {
  if (!error) return <>{children}</>;
  return (
    <Timeline className="px-1 -mb-4">
      <Timeline.Item dot={<CloseCircleFilled className="red-5" />}>
        <Typography.Text className="gray-8">
          {error.shortMessage}
        </Typography.Text>
        <div className="gray-7 text-sm mt-1">
          <div>{error.message}</div>
        </div>
      </Timeline.Item>
    </Timeline>
  );
}
