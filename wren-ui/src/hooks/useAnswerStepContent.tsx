import { useState } from 'react';
import copy from 'copy-to-clipboard';
import { message } from 'antd';
import { COLLAPSE_CONTENT_TYPE } from '@/utils/enum';
import useNativeSQL from '@/hooks/useNativeSQL';
import {
  usePreviewDataMutation,
  PreviewDataMutationResult,
} from '@/apollo/client/graphql/home.generated';

const getTextButton = (isActive: boolean) => ({
  type: 'text',
  className: `d-inline-flex align-center mr-2 ${isActive ? 'gray-9' : 'gray-6'}`,
});

function getButtonProps({
  isLastStep,
  isPreviewData,
  isViewSQL,
  onViewSQL,
  onPreviewData,
  previewDataProps,
}) {
  const previewDataButtonProps = isLastStep
    ? { type: 'primary', className: 'mr-2' }
    : getTextButton(isPreviewData);

  const [viewSQLButtonText, viewSQLButtonProps] = isLastStep
    ? ['View Full SQL']
    : ['View SQL', getTextButton(isViewSQL)];

  return {
    viewSQLButtonText,
    viewSQLButtonProps: {
      ...viewSQLButtonProps,
      onClick: onViewSQL,
    },
    previewDataButtonProps: {
      ...previewDataButtonProps,
      ...previewDataProps,
      onClick: onPreviewData,
    },
  };
}

export default function useAnswerStepContent({
  fullSql,
  isLastStep,
  sql,
  stepIndex,
  threadResponseId,
}: {
  fullSql: string;
  isLastStep: boolean;
  sql: string;
  stepIndex: number;
  threadResponseId: number;
}) {
  const { fetchNativeSQL, nativeSQLResult } = useNativeSQL();

  const [collapseContentType, setCollapseContentType] =
    useState<COLLAPSE_CONTENT_TYPE>(COLLAPSE_CONTENT_TYPE.NONE);

  const [previewData, previewDataResult] = usePreviewDataMutation({
    onError: (error) => console.error(error),
  });

  const onViewSQL = () =>
    setCollapseContentType(COLLAPSE_CONTENT_TYPE.VIEW_SQL);

  const onPreviewData = () => {
    setCollapseContentType(COLLAPSE_CONTENT_TYPE.PREVIEW_DATA);
    nativeSQLResult.setNativeSQLMode(false);
    previewData({
      variables: { where: { responseId: threadResponseId, stepIndex } },
    });
  };

  const onCloseCollapse = () => {
    setCollapseContentType(COLLAPSE_CONTENT_TYPE.NONE);
    nativeSQLResult.setNativeSQLMode(false);
  };

  const onCopyFullSQL = () => {
    copy(nativeSQLResult.nativeSQLMode ? nativeSQLResult.data : fullSql);
    message.success('Copied SQL to clipboard.');
  };

  const onChangeNativeSQL = async (checked: boolean) => {
    nativeSQLResult.setNativeSQLMode(checked);
    checked && fetchNativeSQL({ variables: { responseId: threadResponseId } });
  };

  const isViewSQL = collapseContentType === COLLAPSE_CONTENT_TYPE.VIEW_SQL;

  const isPreviewData =
    collapseContentType === COLLAPSE_CONTENT_TYPE.PREVIEW_DATA;

  const previewDataLoading = previewDataResult.loading;

  const buttonProps = getButtonProps({
    isLastStep,
    isPreviewData,
    isViewSQL,
    onPreviewData,
    onViewSQL,
    previewDataProps: {
      loading: previewDataLoading,
    },
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
      previewDataResult: {
        error: previewDataResult.error,
        loading: previewDataLoading,
        previewData: previewDataResult?.data?.previewData,
      } as unknown as PreviewDataMutationResult,
      nativeSQLResult,
      onChangeNativeSQL,
    },
    ...buttonProps,
  };
}
