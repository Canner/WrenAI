import { Typography } from 'antd';
import { Spinner } from '@/components/PageLoading';

interface Props {
  generating?: boolean;
  correcting?: boolean;
  loading?: boolean;
}

export default function Generating(props: Props) {
  const { loading, generating, correcting } = props;

  return (
    <>
      <Typography.Text className="gray-8">正在生成 SQL</Typography.Text>
      <div className="gray-7 text-sm mt-1">
        {generating || correcting ? (
          <div className="d-flex align-center gx-2">
            {correcting ? '正在修正 SQL' : '生成中'}
            <Spinner className="gray-6" size={12} />
          </div>
        ) : (
          <>
            <div>SQL 已生成完成</div>
            {loading && (
              <div className="d-flex align-center gx-2 mt-1">
                正在整理结果 <Spinner className="gray-6" size={16} />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
