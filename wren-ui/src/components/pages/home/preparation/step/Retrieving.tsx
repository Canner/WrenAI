import { Typography, Tag } from 'antd';
import { makeIterable } from '@/utils/iteration';
import { Spinner } from '@/components/PageLoading';
import ErrorBoundary, {
  Props as ErrorBoundaryProps,
} from '@/components/pages/home/preparation/ErrorBoundary';

interface Props {
  tables: string[];
  loading?: boolean;
  error?: ErrorBoundaryProps['error'];
}

const TagTemplate = ({ name }: { name: string }) => {
  return <Tag className="gray-7">{name}</Tag>;
};

const TagIterator = makeIterable(TagTemplate);

export default function Retrieving(props: Props) {
  const { tables, loading, error } = props;

  const data = tables.map((table) => ({ name: table }));

  return (
    <ErrorBoundary error={error}>
      <Typography.Text className="gray-8">
        Retrieving related models
      </Typography.Text>
      <div className="gray-7 text-sm mt-1">
        {loading ? (
          <div className="d-flex align-center gx-2">
            Searching
            <Spinner className="gray-6" size={12} />
          </div>
        ) : (
          <>
            <div className="mb-1">{tables.length} models found</div>
            <TagIterator data={data} />
          </>
        )}
      </div>
    </ErrorBoundary>
  );
}
