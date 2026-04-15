import { Typography } from 'antd';

export default function SQLPairFinished() {
  return (
    <>
      <Typography.Text className="gray-8">正在应用 SQL 模板</Typography.Text>
      <div className="gray-7 text-sm mt-1">
        <div>已命中匹配的 SQL 模板，正在快速返回结果。</div>
      </div>
    </>
  );
}
