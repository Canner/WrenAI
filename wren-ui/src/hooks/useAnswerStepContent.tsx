import { useState } from 'react';
import copy from 'copy-to-clipboard';
import { message } from 'antd';
import { COLLAPSE_CONTENT_TYPE } from '@/utils/enum';
import {
  useGetNativeSqlLazyQuery,
  usePreviewDataMutation,
  PreviewDataMutationResult,
} from '@/apollo/client/graphql/home.generated';
import { useGetSettingsQuery } from '@/apollo/client/graphql/settings.generated';

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
      onClick: onPreviewData,
    },
  };
}

// we assume that not having a sample dataset means supporting native SQL
function useNativeSQLInfo() {
  const { data: settingsQueryResult } = useGetSettingsQuery();
  const settings = settingsQueryResult?.settings;
  const dataSourceType = settings?.dataSource.type;
  const sampleDataset = settings?.dataSource.sampleDataset;

  return {
    hasNativeSQL: !Boolean(sampleDataset),
    dataSourceType,
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
  const nativeSQLInfo = useNativeSQLInfo();

  const [collapseContentType, setCollapseContentType] =
    useState<COLLAPSE_CONTENT_TYPE>(COLLAPSE_CONTENT_TYPE.NONE);

  const [nativeSQLMode, setNativeSQLMode] = useState<boolean>(false);

  const [previewData, previewDataResult] = usePreviewDataMutation({
    onError: (error) => console.error(error),
  });

  const [
    fetchNativeSQL,
    { data: nativeSQLResult, loading: fetchNativeSQLLoading },
  ] = useGetNativeSqlLazyQuery({
    fetchPolicy: 'cache-and-network',
  });

  const nativeSQL = nativeSQLResult?.nativeSql || '';

  const onViewSQL = () =>
    setCollapseContentType(COLLAPSE_CONTENT_TYPE.VIEW_SQL);

  const onPreviewData = () => {
    setCollapseContentType(COLLAPSE_CONTENT_TYPE.PREVIEW_DATA);
    setNativeSQLMode(false);
    previewData({
      variables: { where: { responseId: threadResponseId, stepIndex } },
    });
  };

  const onCloseCollapse = () => {
    setCollapseContentType(COLLAPSE_CONTENT_TYPE.NONE);
    setNativeSQLMode(false);
  };

  const onCopyFullSQL = () => {
    copy(nativeSQLMode ? nativeSQL : fullSql);
    message.success('Copied SQL to clipboard.');
  };

  const onGetNativeSQL = async (checked: boolean) => {
    setNativeSQLMode(checked);
    checked && fetchNativeSQL({ variables: { responseId: threadResponseId } });
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
            sql: nativeSQLMode ? nativeSQL : fullSql,
          }
        : {
            isViewSQL,
            sql,
          }),
      previewDataResult: {
        error: previewDataResult.error,
        loading: previewDataResult.loading,
        previewData: previewDataResult?.data?.previewData,
      } as unknown as PreviewDataMutationResult,
      nativeSQLInfo,
      onGetNativeSQL,
      nativeSQLResult: {
        data: nativeSQL,
        loading: fetchNativeSQLLoading,
      },
    },
    ...buttonProps,
  };
}
