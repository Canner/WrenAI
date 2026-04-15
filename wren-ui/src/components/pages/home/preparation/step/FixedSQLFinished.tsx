import { Typography } from 'antd';

export default function FixedSQLFinished() {
  return (
    <>
      <Typography.Text className="gray-8">已应用手动 SQL</Typography.Text>
      <div className="gray-7 text-sm mt-1">
        系统在生成 SQL 时遇到问题，现已改为处理你手动提交的 SQL。
      </div>
    </>
  );
}
