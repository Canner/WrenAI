import { Typography } from 'antd';

export default function FixedSQLFinished() {
  return (
    <>
      <Typography.Text className="gray-8">
        User-Provided SQL applied
      </Typography.Text>
      <div className="gray-7 text-sm mt-1">
        System encountered an issue generating SQL. The manually submitted query
        is now being processed.
      </div>
    </>
  );
}
