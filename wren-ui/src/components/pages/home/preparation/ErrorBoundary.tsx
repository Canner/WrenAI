import { Typography } from 'antd';
import { Error } from '@/apollo/client/graphql/__types__';

export interface Props {
  children: React.ReactNode;
  error?: Error & { invalidSql?: string };
}

export default function ErrorBoundary({ children, error }: Props) {
  if (!error) return <>{children}</>;
  return (
    <>
      <Typography.Text className="gray-8">{error.shortMessage}</Typography.Text>
      <div className="gray-7 text-sm mt-1">
        <div>{error.message}</div>
      </div>
    </>
  );
}
