import { Typography, Tag } from 'antd';
import { makeIterable } from '@/utils/iteration';
import { Spinner } from '@/components/PageLoading';

interface Props {
  tables: string[];
  loading?: boolean;
  isAdjustment?: boolean;
}

const TagTemplate = ({ name }: { name: string }) => {
  return <Tag className="gray-7 mb-2">{name}</Tag>;
};

const TagIterator = makeIterable(TagTemplate);

export default function Retrieving(props: Props) {
  const { tables, loading, isAdjustment } = props;

  const data = tables.map((table) => ({ name: table }));

  const title = isAdjustment
    ? '已应用用户选择的数据模型'
    : '正在检索最相关的数据模型';

  const modelDescription = isAdjustment ? (
    <>{tables.length} 个模型已应用</>
  ) : (
    <>已识别出 {tables.length} 个候选模型</>
  );

  return (
    <>
      <Typography.Text className="gray-8">{title}</Typography.Text>
      <div className="gray-7 text-sm mt-1">
        {loading ? (
          <div className="d-flex align-center gx-2">
            检索中
            <Spinner className="gray-6" size={12} />
          </div>
        ) : (
          <>
            <div className="mb-1">{modelDescription}</div>
            <TagIterator data={data} />
          </>
        )}
      </div>
    </>
  );
}
