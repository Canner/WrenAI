import { useState } from 'react';
import copy from 'copy-to-clipboard';
import { message } from 'antd';
import { COLLAPSE_CONTENT_TYPE } from '@/utils/enum';
import useNativeSQL from '@/hooks/useNativeSQL';
import { usePreviewBreakdownDataMutation } from '@/apollo/client/graphql/home.generated';

const getTextButton = (isActive: boolean) => ({
  type: 'text',
  className: `d-inline-flex align-center mr-2 ${isActive ? 'gray-9' : 'gray-6'}`,
});

function getButtonsProps({
  isLastStep,
  isPreviewData,
  isViewSQL,
  previewDataProps,
  onViewSQL,
  onPreviewData,
}: {
  isLastStep: boolean;
  isPreviewData: boolean;
  isViewSQL: boolean;
  previewDataProps: { loading: boolean };
  onViewSQL: () => void;
  onPreviewData: () => Promise<void>;
}) {
  const previewDataButtonText = 'Prevew data';
  const viewSQLButtonText = isLastStep ? 'View full SQL' : 'View SQL';
  const previewDataButtonProps = isLastStep
    ? { type: 'primary', className: 'mr-2' }
    : getTextButton(isPreviewData);
  const viewSQLButtonProps = isLastStep ? {} : getTextButton(isViewSQL);

  return {
    viewSQLButtonProps: {
      ...viewSQLButtonProps,
      children: viewSQLButtonText,
      onClick: onViewSQL,
    },
    previewDataButtonProps: {
      ...previewDataButtonProps,
      children: previewDataButtonText,
      loading: previewDataProps.loading,
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

  const [previewData, previewDataResult] = usePreviewBreakdownDataMutation({
    onError: (error) => console.error(error),
  });

  const onViewSQL = () =>
    setCollapseContentType(COLLAPSE_CONTENT_TYPE.VIEW_SQL);

  const onPreviewData = async () => {
    setCollapseContentType(COLLAPSE_CONTENT_TYPE.PREVIEW_DATA);
    nativeSQLResult.setNativeSQLMode(false);
    await previewData({
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
  const answerButtonsProps = getButtonsProps({
    isLastStep,
    isPreviewData,
    isViewSQL,
    onPreviewData,
    onViewSQL,
    previewDataProps: {
      loading: previewDataLoading,
    },
  });
  const isViewFullSQL = isLastStep && isViewSQL;
  const displayedSQL = isLastStep ? fullSql : sql;

  return {
    ...answerButtonsProps,
    collapseContentProps: {
      isPreviewData,
      isViewSQL,
      isViewFullSQL,
      sql: displayedSQL,
      previewDataResult: {
        error: previewDataResult.error,
        loading: previewDataLoading,
        previewData: previewDataResult?.data?.previewBreakdownData,
      },
      nativeSQLResult,
      onCopyFullSQL,
      onCloseCollapse,
      onChangeNativeSQL,
    },
  };
}
