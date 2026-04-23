import Link from 'next/link';
import { Button, Tooltip } from 'antd';
import FileDoneOutlined from '@ant-design/icons/FileDoneOutlined';
import SaveOutlined from '@ant-design/icons/SaveOutlined';
import { Path } from '@/utils/enum';
import type { ViewInfo } from '@/types/modeling';

import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { buildKnowledgeWorkbenchParams } from '@/utils/knowledgeWorkbench';

interface Props {
  view?: ViewInfo;
  onClick: () => void;
  title?: string;
  savedTitle?: string;
  variant?: 'text' | 'icon';
}

export default function ViewBlock({
  view,
  onClick,
  title = '保存为视图',
  savedTitle = '查看已保存视图',
  variant = 'text',
}: Props) {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const isViewSaved = !!view;
  const savedHref = isViewSaved
    ? runtimeScopeNavigation.hrefWorkspace(
        Path.Knowledge,
        buildKnowledgeWorkbenchParams('modeling', {
          viewId: view.id,
          openMetadata: true,
        }),
      )
    : null;

  if (variant === 'icon') {
    if (isViewSaved && savedHref) {
      return (
        <Tooltip title={`${savedTitle}：${view.displayName}`}>
          <Link href={savedHref} target="_blank" rel="noreferrer noopener">
            <Button
              aria-label={savedTitle}
              className="gray-6"
              type="text"
              size="small"
              shape="circle"
              icon={<FileDoneOutlined />}
            />
          </Link>
        </Tooltip>
      );
    }

    return (
      <Tooltip title={title}>
        <Button
          aria-label={title}
          className="gray-6"
          type="text"
          size="small"
          shape="circle"
          icon={<SaveOutlined />}
          onClick={onClick}
        />
      </Tooltip>
    );
  }

  if (isViewSaved) {
    return (
      <div className="gray-6 text-medium">
        <FileDoneOutlined className="mr-2" />
        基于已保存视图生成{' '}
        <Link
          className="gray-7"
          href={savedHref as string}
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
