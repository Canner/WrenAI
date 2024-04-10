import { Button, Typography } from 'antd';
import CodeBlock from '@/components/editor/CodeBlock';
import PreviewData from '@/components/pages/home/promptThread/PreviewData';

export interface Props {
  referenceName: string;
  refSql: string;
}

export default function ViewMetadata(props: Props) {
  const { refSql, referenceName } = props || {};

  // TODO: connect real preview view data API

  return (
    <>
      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">Name</Typography.Text>
        <div>{referenceName || '-'}</div>
      </div>

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          SQL statement
        </Typography.Text>
        <CodeBlock code={refSql} showLineNumbers height="300" />
      </div>

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Data preview (100 rows)
        </Typography.Text>
        <Button>Preview data</Button>
        <div className="my-3">
          <PreviewData loading={false} />
        </div>
      </div>
    </>
  );
}
