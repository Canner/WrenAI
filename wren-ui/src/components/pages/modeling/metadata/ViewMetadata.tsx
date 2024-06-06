import { Button, Typography } from 'antd';
import CodeBlock from '@/components/editor/CodeBlock';
import PreviewData from '@/components/dataPreview/PreviewData';
import { COLUMN } from '@/components/table/BaseTable';
import FieldTable from '@/components/table/FieldTable';
import { DiagramView } from '@/utils/data';
import { usePreviewViewDataMutation } from '@/apollo/client/graphql/view.generated';

export type Props = DiagramView;

export default function ViewMetadata(props: Props) {
  const {
    displayName,
    description,
    fields = [],
    statement,
    viewId,
  } = props || {};

  const [previewViewData, previewViewDataResult] = usePreviewViewDataMutation({
    onError: (error) => console.error(error),
  });

  const onPreviewData = () => {
    previewViewData({ variables: { where: { id: viewId } } });
  };

  // View only can input Name (alias), so it should show alias as Name in metadata.
  return (
    <>
      <div className="mb-6" data-testid="metadata__name">
        <Typography.Text className="d-block gray-7 mb-2">Name</Typography.Text>
        <div>{displayName || '-'}</div>
      </div>

      <div className="mb-6" data-testid="metadata__description">
        <Typography.Text className="d-block gray-7 mb-2">
          Description
        </Typography.Text>
        <div>{description || '-'}</div>
      </div>

      <div className="mb-6" data-testid="metadata__columns">
        <Typography.Text className="d-block gray-7 mb-2">
          Columns ({fields.length})
        </Typography.Text>
        <FieldTable
          columns={[COLUMN.NAME, COLUMN.TYPE, COLUMN.DESCRIPTION]}
          dataSource={fields}
          showExpandable
        />
      </div>

      <div className="mb-6" data-testid="metadata__sql-statement">
        <Typography.Text className="d-block gray-7 mb-2">
          SQL statement
        </Typography.Text>
        <CodeBlock code={statement} showLineNumbers maxHeight="300" />
      </div>

      <div className="mb-6" data-testid="metadata__preview-data">
        <Typography.Text className="d-block gray-7 mb-2">
          Data preview (100 rows)
        </Typography.Text>
        <Button onClick={onPreviewData} loading={previewViewDataResult.loading}>
          Preview data
        </Button>
        <div className="my-3">
          <PreviewData
            error={previewViewDataResult.error}
            loading={previewViewDataResult.loading}
            previewData={previewViewDataResult?.data?.previewViewData}
          />
        </div>
      </div>
    </>
  );
}
