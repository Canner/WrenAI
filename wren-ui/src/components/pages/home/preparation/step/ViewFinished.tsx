import { Typography } from 'antd';

export default function ViewFinished() {
  return (
    <>
      <Typography.Text className="gray-8">Using pre-saved view</Typography.Text>
      <div className="gray-7 text-sm mt-1">
        <div>Matching saved view found. Returning results instantly.</div>
      </div>
    </>
  );
}
