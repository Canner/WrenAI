import { useMemo, useState } from 'react';
import { keyBy } from 'lodash';
import { Alert, Col, Row, Typography, Button, message } from 'antd';
import FieldTable from '@/components/table/FieldTable';
import CalculatedFieldTable from '@/components/table/CalculatedFieldTable';
import RelationTable from '@/components/table/RelationTable';
import PreviewData from '@/components/dataPreview/PreviewData';
import { DiagramModel } from '@/utils/data';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { DiagramModelField, DiagramModelRelationField } from '@/types/modeling';
import {
  previewModelData,
  type ModelPreviewDataResponse,
} from '@/utils/modelRest';

export type Props = DiagramModel & {
  readOnly?: boolean;
};

const isNonNullable = <T,>(value: T | null | undefined): value is T =>
  value != null;

export default function ModelMetadata(props: Props) {
  const {
    modelId,
    displayName,
    referenceName,
    fields = [],
    calculatedFields = [],
    relationFields = [],
    description,
    readOnly = false,
  } = props || {};
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [previewDataResult, setPreviewDataResult] = useState<{
    loading: boolean;
    data?: ModelPreviewDataResponse;
    error?: Error;
  }>({
    loading: false,
  });

  // Model preview data should show alias as column name.
  const normalizedFields = useMemo(
    () => (fields || []).filter(isNonNullable) as DiagramModelField[],
    [fields],
  );
  const normalizedCalculatedFields = useMemo(
    () => (calculatedFields || []).filter(isNonNullable) as DiagramModelField[],
    [calculatedFields],
  );
  const normalizedRelationFields = useMemo(
    () =>
      (relationFields || []).filter(
        isNonNullable,
      ) as DiagramModelRelationField[],
    [relationFields],
  );

  const fieldsMap = useMemo(
    () => keyBy(normalizedFields, 'referenceName'),
    [normalizedFields],
  );
  const previewData = useMemo(() => {
    const rawPreviewData = previewDataResult.data;
    const columns = (rawPreviewData?.columns || []).map(
      (column: { name: string; type: string }) => {
        const alias = fieldsMap[column.name]?.displayName;
        return { ...column, name: alias || column.name };
      },
    );
    return rawPreviewData ? { ...rawPreviewData, columns } : undefined;
  }, [fieldsMap, previewDataResult.data]);

  const onPreviewData = async () => {
    setPreviewDataResult((previous) => ({
      ...previous,
      loading: true,
      error: undefined,
    }));
    try {
      const data = await previewModelData(
        runtimeScopeNavigation.selector,
        modelId,
      );
      setPreviewDataResult({
        loading: false,
        data,
      });
    } catch (error) {
      const nextError =
        error instanceof Error
          ? error
          : new Error('预览模型数据失败，请稍后重试。');
      const errorMessage = resolveAbortSafeErrorMessage(
        nextError,
        '预览模型数据失败，请稍后重试。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
      setPreviewDataResult({
        loading: false,
        data: undefined,
        error: nextError,
      });
    }
  };

  return (
    <>
      <Row className="mb-6">
        <Col span={12} data-testid="metadata__name">
          <Typography.Text className="d-block gray-7 mb-2">
            名称
          </Typography.Text>
          <div>{referenceName || '-'}</div>
        </Col>
        <Col span={12} data-testid="metadata__alias">
          <Typography.Text className="d-block gray-7 mb-2">
            显示名称
          </Typography.Text>
          <div>{displayName || '-'}</div>
        </Col>
      </Row>
      <div className="mb-6" data-testid="metadata__description">
        <Typography.Text className="d-block gray-7 mb-2">描述</Typography.Text>
        <div>{description || '-'}</div>
      </div>

      <div className="mb-6" data-testid="metadata__columns">
        <Typography.Text className="d-block gray-7 mb-2">
          字段（{normalizedFields.length}）
        </Typography.Text>
        <FieldTable dataSource={normalizedFields} showExpandable />
      </div>

      {!!normalizedCalculatedFields.length && (
        <div className="mb-6" data-testid="metadata__calculated-fields">
          <Typography.Text className="d-block gray-7 mb-2">
            计算字段（{normalizedCalculatedFields.length}）
          </Typography.Text>
          <CalculatedFieldTable
            dataSource={normalizedCalculatedFields}
            showExpandable
          />
        </div>
      )}

      {!!normalizedRelationFields.length && (
        <div className="mb-6" data-testid="metadata__relationships">
          <Typography.Text className="d-block gray-7 mb-2">
            关系（{normalizedRelationFields.length}）
          </Typography.Text>
          <RelationTable dataSource={normalizedRelationFields} showExpandable />
        </div>
      )}

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
            previewData={previewData}
          />
        </div>
      </div>
    </>
  );
}
