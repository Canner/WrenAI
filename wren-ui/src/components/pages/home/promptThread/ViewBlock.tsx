import Link from 'next/link';
import { Button } from 'antd';
import FileDoneOutlined from '@ant-design/icons/FileDoneOutlined';
import SaveOutlined from '@ant-design/icons/SaveOutlined';
import { Path } from '@/utils/enum';
import { ViewInfo } from '@/types/api';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';

interface Props {
  view?: ViewInfo;
  onClick: () => void;
}

export default function ViewBlock({ view, onClick }: Props) {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const isViewSaved = !!view;

  if (isViewSaved) {
    return (
      <div className="gray-6 text-medium">
        <FileDoneOutlined className="mr-2" />
        基于已保存视图生成{' '}
        <Link
          className="gray-7"
          href={runtimeScopeNavigation.hrefWorkspace(Path.Modeling, {
            viewId: view.id,
            openMetadata: true,
          })}
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
      className="gray-6"
      type="text"
      size="small"
      icon={<SaveOutlined />}
      onClick={onClick}
    >
      保存为视图
    </Button>
  );
}
