import { Typography, Tag } from 'antd';
import { makeIterable } from '@/utils/iteration';
import { Loading } from '@/components/PageLoading';

interface Props {
  tables: string[];
  loading?: boolean;
}

const TagTemplate = ({ name }: { name: string }) => {
  return <Tag>{name}</Tag>;
};

const TagIterator = makeIterable(TagTemplate);

export default function Retrieving(props: Props) {
  const { tables, loading } = props;

  const data = tables.map((table) => ({ name: table }));

  return (
    <>
      <Typography.Text className="gray-8">
        Retrieving related tables
      </Typography.Text>
      <div className="gray-7 text-sm mt-1">
        {loading ? (
          <div className="d-flex align-center gx-2">
            Searching
            <Loading className="gray-6" size={12} loading />
          </div>
        ) : (
          <>
            <div className="mb-1">3 tables found</div>
            <TagIterator data={data} />
          </>
        )}
      </div>
    </>
  );
}
