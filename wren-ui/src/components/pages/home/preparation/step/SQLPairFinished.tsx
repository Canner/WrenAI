import { Typography } from 'antd';

export default function SQLPairFinished() {
  return (
    <>
      <Typography.Text className="gray-8">
        Using question-SQL pair
      </Typography.Text>
      <div className="gray-7 text-sm mt-1">
        <div>
          Matching question-SQL pair found. Returning results instantly.
        </div>
      </div>
    </>
  );
}
