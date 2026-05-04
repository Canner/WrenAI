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
    ? 'User-selected models applied'
    : 'Retrieving top 10 model candidates';

  const modelDescription = isAdjustment ? (
    <>{tables.length} models applied</>
  ) : (
    <>Top {tables.length} model candidates identified</>
  );

  return (
    <>
      <Typography.Text className="gray-8">{title}</Typography.Text>
      <div className="gray-7 text-sm mt-1">
        {loading ? (
          <div className="d-flex align-center gx-2">
            Searching
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
