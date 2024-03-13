import { useState } from 'react';
import copy from 'copy-to-clipboard';
import { message } from 'antd';
import { COLLAPSE_CONTENT_TYPE } from '@/utils/enum';

function getButtonProps({
  isLastStep,
  isPreviewData,
  isViewSQL,
  onViewSQL,
  onPreviewData,
}) {
  const previewDataButtonProps = isLastStep
    ? { type: 'primary', className: 'mr-2' }
    : {
        type: 'text',
        className: `mr-2 ${isPreviewData ? 'gray-9' : 'gray-6'}`,
      };

  const [viewSQLButtonText, viewSQLButtonProps] = isLastStep
    ? ['View Full SQL', { className: 'adm-btn-gray' }]
    : [
        'View SQL',
        { type: 'text', className: isViewSQL ? 'gray-9' : 'gray-6' },
      ];

  return {
    viewSQLButtonText,
    viewSQLButtonProps: {
      ...viewSQLButtonProps,
      onClick: onViewSQL,
    },
    previewDataButtonProps: {
      ...previewDataButtonProps,
      onClick: onPreviewData,
    },
  };
}

export default function useAnswerStepContent({
  fullSql,
  isLastStep,
  sql,
}: {
  fullSql: string;
  isLastStep: boolean;
  sql: string;
}) {
  const [collapseContentType, setCollapseContentType] =
    useState<COLLAPSE_CONTENT_TYPE>(COLLAPSE_CONTENT_TYPE.NONE);

  const onViewSQL = () =>
    setCollapseContentType(COLLAPSE_CONTENT_TYPE.VIEW_SQL);

  const onPreviewData = () =>
    setCollapseContentType(COLLAPSE_CONTENT_TYPE.PREVIEW_DATA);

  const onCloseCollapse = () =>
    setCollapseContentType(COLLAPSE_CONTENT_TYPE.NONE);

  const onCopyFullSQL = () => {
    copy(fullSql);
    message.success('Copied SQL to clipboard.');
  };

  const isViewSQL = collapseContentType === COLLAPSE_CONTENT_TYPE.VIEW_SQL;

  const isPreviewData =
    collapseContentType === COLLAPSE_CONTENT_TYPE.PREVIEW_DATA;

  const buttonProps = getButtonProps({
    isLastStep,
    isPreviewData,
    isViewSQL,
    onPreviewData,
    onViewSQL,
  });

  return {
    collapseContentProps: {
      isPreviewData,
      onCloseCollapse,
      onCopyFullSQL,
      ...(isLastStep
        ? {
            isViewFullSQL: isViewSQL,
            sql: fullSql,
          }
        : {
            isViewSQL,
            sql,
          }),
    },
    ...buttonProps,
  };
}
