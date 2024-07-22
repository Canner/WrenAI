import { useMemo } from 'react';
import { Alert, Typography } from 'antd';
import { ApolloError } from '@apollo/client';
import { getColumnTypeIcon } from '@/utils/columnType';
import PreviewDataContent from '@/components/dataPreview/PreviewDataContent';
import { parseGraphQLError } from '@/utils/errorHandler';

const { Text } = Typography;

const getPreviewColumns = (cols) =>
  cols.map(({ name, type }: Record<string, any>) => {
    const columnTypeIcon = getColumnTypeIcon({ type }, { title: type });

    return {
      dataIndex: name,
      titleText: name,
      key: name,
      ellipsis: true,
      title: (
        <>
          {columnTypeIcon}
          <Text title={name} className="ml-1">
            {name}
          </Text>
        </>
      ),
    };
  });

interface Props {
  previewData?: {
    data: Array<Array<any>>;
    columns: Array<{
      name: string;
      type: string;
    }>;
  };
  loading: boolean;
  error?: ApolloError;
  locale?: { emptyText: React.ReactNode };
}

export default function PreviewData(props: Props) {
  const { previewData, loading, error, locale } = props;

  const columns = useMemo(
    () => previewData && getPreviewColumns(previewData.columns),
    [previewData],
  );

  const hasErrorMessage = error && error.message;
  if (!loading && hasErrorMessage) {
    const { message, shortMessage } = parseGraphQLError(error);

    return (
      <Alert
        message={shortMessage}
        description={message}
        type="error"
        showIcon
      />
    );
  }

  return (
    <PreviewDataContent
      columns={columns}
      data={previewData?.data || []}
      loading={loading}
      locale={locale}
    />
  );
}
