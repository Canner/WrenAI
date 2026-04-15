import { useState } from 'react';
import { Alert, Button, Typography, message } from 'antd';
import SQLCodeBlock from '@/components/code/SQLCodeBlock';
import PreviewData from '@/components/dataPreview/PreviewData';
import { COLUMN } from '@/components/table/BaseTable';
import FieldTable from '@/components/table/FieldTable';
import { DiagramView } from '@/utils/data';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import {
  previewViewData,
  type ViewPreviewDataResponse,
} from '@/utils/viewRest';

export type Props = DiagramView & {
  readOnly?: boolean;
};

export default function ViewMetadata(props: Props) {
  const {
    displayName,
    description,
    fields: rawFields = [],
    statement,
    viewId,
    readOnly = false,
  } = props || {};
  const fields = rawFields.filter(
    (field): field is NonNullable<(typeof rawFields)[number]> => field !== null,
  );
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [previewDataResult, setPreviewDataResult] = useState<{
    loading: boolean;
    data?: ViewPreviewDataResponse;
    error?: Error;
  }>({
    loading: false,
  });

  const onPreviewData = async () => {
    setPreviewDataResult((previous) => ({
      ...previous,
      loading: true,
      error: undefined,
    }));
    try {
      const data = await previewViewData(
        runtimeScopeNavigation.selector,
        viewId,
      );
      setPreviewDataResult({
        loading: false,
        data,
      });
    } catch (error) {
      const nextError =
        error instanceof Error
          ? error
          : new Error('预览视图数据失败，请稍后重试。');
      message.error(nextError.message || '预览视图数据失败，请稍后重试。');
      setPreviewDataResult({
        loading: false,
        data: undefined,
        error: nextError,
      });
    }
  };

  // View only can input Name (alias), so it should show alias as Name in metadata.
  return (
    <>
      <div className="mb-6" data-testid="metadata__name">
        <Typography.Text className="d-block gray-7 mb-2">名称</Typography.Text>
        <div>{displayName || '-'}</div>
      </div>

      <div className="mb-6" data-testid="metadata__description">
        <Typography.Text className="d-block gray-7 mb-2">描述</Typography.Text>
        <div>{description || '-'}</div>
      </div>

      <div className="mb-6" data-testid="metadata__columns">
        <Typography.Text className="d-block gray-7 mb-2">
          字段（{fields.length}）
        </Typography.Text>
        <FieldTable
          columns={[COLUMN.NAME, COLUMN.TYPE, COLUMN.DESCRIPTION]}
          dataSource={fields}
          showExpandable
        />
      </div>

      <div className="mb-6" data-testid="metadata__sql-statement">
        <Typography.Text className="d-block gray-7 mb-2">
          SQL 语句
        </Typography.Text>
        <SQLCodeBlock code={statement} showLineNumbers maxHeight="300" />
      </div>

      <div className="mb-6" data-testid="metadata__preview-data">
        <Typography.Text className="d-block gray-7 mb-2">
          数据预览（100 行）
        </Typography.Text>
        <Button
          onClick={onPreviewData}
          loading={previewDataResult.loading}
          disabled={readOnly}
        >
          预览数据
        </Button>
        {readOnly ? (
          <Alert
            className="mt-3"
            showIcon
            type="info"
            message="历史快照下不支持数据预览。"
          />
        ) : null}
        <div className="my-3">
          <PreviewData
            error={previewDataResult.error}
            loading={previewDataResult.loading}
            previewData={previewDataResult.data}
          />
        </div>
      </div>
    </>
  );
}
