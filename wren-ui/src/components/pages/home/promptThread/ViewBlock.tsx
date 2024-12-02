import Link from 'next/link';
import { Button } from 'antd';
import FileDoneOutlined from '@ant-design/icons/FileDoneOutlined';
import SaveOutlined from '@ant-design/icons/SaveOutlined';
import { Path } from '@/utils/enum';
import { ViewInfo } from '@/apollo/client/graphql/__types__';

interface Props {
  view?: ViewInfo;
  onClick: () => void;
}

export default function ViewBlock({ view, onClick }: Props) {
  const isViewSaved = !!view;

  if (isViewSaved) {
    return (
      <div className="mt-2 gray-6 text-medium">
        <FileDoneOutlined className="mr-2" />
        Generated from saved view{' '}
        <Link
          className="gray-7"
          href={`${Path.Modeling}?viewId=${view.id}&openMetadata=true`}
          target="_blank"
          rel="noreferrer noopener"
        >
          {view.displayName}
        </Link>
      </div>
    );
  }

  return (
    <Button
      className="mt-2 gray-6"
      type="text"
      size="small"
      icon={<SaveOutlined />}
      onClick={onClick}
    >
      Save as View
    </Button>
  );
}
