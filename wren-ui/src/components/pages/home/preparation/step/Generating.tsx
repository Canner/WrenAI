import { Typography } from 'antd';
import { Spinner } from '@/components/PageLoading';
import ErrorBoundary, {
  Props as ErrorBoundaryProps,
} from '@/components/pages/home/preparation/ErrorBoundary';

interface Props {
  generating?: boolean;
  correcting?: boolean;
  loading?: boolean;
  error?: ErrorBoundaryProps['error'];
}

export default function Generating(props: Props) {
  const { loading, generating, correcting, error } = props;

  return (
    <ErrorBoundary error={error}>
      <Typography.Text className="gray-8">
        Generating SQL statement
      </Typography.Text>
      <div className="gray-7 text-sm mt-1">
        {generating || correcting ? (
          <div className="d-flex align-center gx-2">
            {correcting ? 'Correcting SQL statement' : 'Generating'}
            <Spinner className="gray-6" size={12} />
          </div>
        ) : (
          <>
            <div>Successfully generated SQL statement</div>
            {loading && (
              <div className="d-flex align-center gx-2 mt-1">
                Wrapping up <Spinner className="gray-6" size={16} />
              </div>
            )}
          </>
        )}
      </div>
    </ErrorBoundary>
  );
}
