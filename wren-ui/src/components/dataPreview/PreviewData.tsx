import { memo, useMemo } from 'react';
import { Alert, Typography, Button } from 'antd';
import { ApolloError } from '@apollo/client';
import styled from 'styled-components';
import { getColumnTypeIcon } from '@/utils/columnType';
import PreviewDataContent from '@/components/dataPreview/PreviewDataContent';
import { parseGraphQLError } from '@/utils/errorHandler';

const { Text } = Typography;

const StyledCell = styled.div`
  position: relative;

  .copy-icon {
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    opacity: 0;
    transition: opacity 0.3s;
  }

  .ant-typography-copy {
    margin: -4px;
  }

  &:hover .copy-icon {
    opacity: 1;
  }
`;

const ColumnTitle = memo((props: { name: string; type: any }) => {
  const { name, type } = props;
  const columnTypeIcon = getColumnTypeIcon({ type }, { title: type });

  return (
    <>
      {columnTypeIcon}
      <Text title={name} className="ml-1">
        {name}
      </Text>
    </>
  );
});

const ColumnContext = memo((props: { text: string; copyable: boolean }) => {
  const { text, copyable } = props;
  return (
    <StyledCell className="text-truncate">
      <span title={text} className="text text-container">
        {text}
      </span>
      {copyable && (
        <Button size="small" className="copy-icon">
          <Text copyable={{ text, tooltips: false }} className="gray-8" />
        </Button>
      )}
    </StyledCell>
  );
});

const getPreviewColumns = (cols, { copyable }) =>
  cols.map(({ name, type }: Record<string, any>) => {
    return {
      dataIndex: name,
      titleText: name,
      key: name,
      ellipsis: true,
      title: <ColumnTitle name={name} type={type} />,
      render: (text) => <ColumnContext text={text} copyable={copyable} />,
      onCell: () => ({ style: { lineHeight: '24px' } }),
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
  copyable?: boolean;
}

export default function PreviewData(props: Props) {
  const { previewData, loading, error, locale, copyable = true } = props;

  const columns = useMemo(
    () =>
      previewData?.columns &&
      getPreviewColumns(previewData.columns, { copyable }),
    [previewData?.columns, copyable],
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
