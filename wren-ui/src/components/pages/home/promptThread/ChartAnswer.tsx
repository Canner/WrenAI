import clsx from 'clsx';
import dynamic from 'next/dynamic';
import styled from 'styled-components';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { Alert, Form, Button, Skeleton, Modal, Select, message } from 'antd';
import { attachLoading } from '@/utils/helper';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import BasicProperties, {
  PropertiesProps,
} from '@/components/chart/properties/BasicProperties';
import { ChartTaskStatus, ChartType, DashboardItemType } from '@/types/home';
import DonutProperties from '@/components/chart/properties/DonutProperties';
import LineProperties from '@/components/chart/properties/LineProperties';
import StackedBarProperties from '@/components/chart/properties/StackedBarProperties';
import GroupedBarProperties from '@/components/chart/properties/GroupedBarProperties';
import { Props as AnswerResultProps } from '@/components/pages/home/promptThread/AnswerResult';
import { isEmpty, isEqual } from 'lodash';
import {
  getChartSpecFieldTitleMap,
  getChartSpecOptionValues,
} from '@/components/chart/meta';
import {
  loadDashboardListPayload,
  type DashboardListItem,
} from '@/utils/dashboardRest';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { usePromptThreadActionsStore } from './store';
import useResponsePreviewData from '@/hooks/useResponsePreviewData';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { createDashboardItem } from '@/utils/homeRest';

const Chart = dynamic(() => import('@/components/chart'), {
  ssr: false,
});

const StyledSkeleton = styled(Skeleton)`
  padding: 16px;
  .ant-skeleton-paragraph {
    margin-bottom: 0;
  }
`;

const ChartWrapper = styled.div`
  position: relative;
  padding-top: 0;
  transition: padding-top 0.2s ease-out;
  &.isEditMode {
    padding-top: 72px;
  }
`;

const Toolbar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: var(--gray-3);
  padding: 8px 16px;
  position: absolute;
  top: -72px;
  left: 0;
  right: 0;
  transition: top 0.2s ease-out;
  &.isEditMode {
    top: 0;
  }
`;

const ResultActionButton = styled(Button)`
  && {
    height: 34px;
    border-radius: 10px;
    padding-inline: 12px;
    font-weight: 500;
  }
`;

const normalizeFieldToken = (value: string) =>
  value.replace(/[`"]/g, '').replace(/\s+/g, '').trim().toLowerCase();

const buildFieldAliases = (field: string): string[] => {
  const normalized = normalizeFieldToken(field);
  if (!normalized) return [];

  const aliases = new Set<string>([normalized]);
  if (normalized.includes('.')) {
    aliases.add(normalized.split('.').pop() as string);
  }

  const aggregateMatch = normalized.match(/^([a-z_][a-z0-9_]*)\((.+)\)$/i);
  if (aggregateMatch) {
    const fn = aggregateMatch[1];
    const arg = aggregateMatch[2];
    aliases.add(`${fn}(${arg})`);
    if (arg.includes('.')) {
      aliases.add(`${fn}(${arg.split('.').pop()})`);
    }
  }

  return Array.from(aliases);
};

const isCompatibleFieldName = (targetField: string, sourceField: string) => {
  const targetAliases = buildFieldAliases(targetField);
  if (targetAliases.length === 0) return false;
  const sourceAliases = new Set(buildFieldAliases(sourceField));
  return targetAliases.some((alias) => sourceAliases.has(alias));
};

type DashboardOption = Pick<DashboardListItem, 'id' | 'name'>;

const toPreferredRenderer = (value: unknown): 'svg' | 'canvas' | undefined =>
  value === 'svg' || value === 'canvas' ? value : undefined;

export const getIsChartFinished = (
  status?: ChartTaskStatus | null,
): boolean => {
  if (!status) {
    return false;
  }
  return [
    ChartTaskStatus.FINISHED,
    ChartTaskStatus.FAILED,
    ChartTaskStatus.STOPPED,
  ].includes(status);
};

const getDynamicProperties = (chartType?: ChartType | null) => {
  const propertiesMap: Partial<
    Record<ChartType, ComponentType<PropertiesProps>>
  > = {
    [ChartType.GROUPED_BAR]: GroupedBarProperties,
    [ChartType.STACKED_BAR]: StackedBarProperties,
    [ChartType.LINE]: LineProperties,
    [ChartType.MULTI_LINE]: LineProperties,
    [ChartType.PIE]: DonutProperties,
  };
  if (!chartType) {
    return BasicProperties;
  }
  return propertiesMap[chartType] || BasicProperties;
};

export default function ChartAnswer(props: AnswerResultProps) {
  const { onGenerateChartAnswer, onAdjustChartAnswer } =
    usePromptThreadActionsStore();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const { shouldAutoPreview, threadResponse } = props;
  const [regenerating, setRegenerating] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [newValues, setNewValues] = useState<Record<string, unknown> | null>(
    null,
  );
  const [hasRequestedPreview, setHasRequestedPreview] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [pinTargetDashboardId, setPinTargetDashboardId] = useState<
    number | null
  >(null);

  const [form] = Form.useForm();
  const chartType = Form.useWatch('chartType', form);
  const { chartDetail } = threadResponse;
  const { error, status, adjustment } = chartDetail || {};
  const effectiveChartStatus = status || null;

  const previewDataResult = useResponsePreviewData(threadResponse.id);
  const { ensureLoaded: ensurePreviewLoaded } = previewDataResult;
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [dashboardOptions, setDashboardOptions] = useState<DashboardOption[]>(
    [],
  );
  const [pinSubmitting, setPinSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDashboardsLoading(true);

    void loadDashboardListPayload({
      selector: runtimeScopeNavigation.selector,
      useCache: true,
    })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setDashboardOptions(payload);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '加载看板列表失败。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
        setDashboardOptions([]);
      })
      .finally(() => {
        if (!cancelled) {
          setDashboardsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runtimeScopeNavigation.selector]);

  const chartSpec = useMemo(() => {
    if (
      !chartDetail?.chartSchema ||
      (getIsChartFinished(effectiveChartStatus) &&
        isEmpty(chartDetail?.chartSchema))
    )
      return null;
    return chartDetail.chartSchema;
  }, [chartDetail, effectiveChartStatus]);

  const shouldRequestPreview = shouldAutoPreview || !!chartSpec;

  useEffect(() => {
    setHasRequestedPreview(false);
  }, [threadResponse.id]);

  useEffect(() => {
    if (!shouldRequestPreview || hasRequestedPreview) {
      return;
    }

    setHasRequestedPreview(true);
    ensurePreviewLoaded().catch((error) => {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载图表数据失败，请稍后重试。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    });
  }, [ensurePreviewLoaded, hasRequestedPreview, shouldRequestPreview]);

  const chartOptionValues = useMemo(() => {
    if (!chartDetail) {
      return {
        chartType: null,
        xAxis: null,
        yAxis: null,
        color: null,
        xOffset: null,
        theta: null,
      };
    }
    return getChartSpecOptionValues(chartDetail);
  }, [chartDetail]);

  const chartSpecFieldTitleMap = useMemo(() => {
    return getChartSpecFieldTitleMap(chartSpec?.encoding);
  }, [chartSpec]);

  const localizedChartDescription = useMemo(() => {
    const rawDescription = chartDetail?.description || '';
    if (!rawDescription) return '';
    if (/[\u4e00-\u9fff]/.test(rawDescription)) {
      return rawDescription;
    }
    return '该图表用于展示当前查询结果，帮助你更直观地比较不同维度之间的数据差异。';
  }, [chartDetail?.description]);

  const chartDataFields = useMemo(() => {
    const encoding = chartSpec?.encoding as Record<string, { field?: string }>;
    if (!encoding) return [] as string[];

    const candidates = ['x', 'y', 'xOffset', 'color', 'theta', 'size', 'text'];
    return candidates
      .map((key) => encoding[key]?.field)
      .filter((field): field is string => !!field);
  }, [chartSpec]);

  const preferredRenderer = useMemo(
    () => toPreferredRenderer(chartDetail?.renderHints?.preferredRenderer),
    [chartDetail?.renderHints],
  );

  const validationErrors = useMemo(
    () =>
      (chartDetail?.validationErrors || []).filter((error): error is string =>
        Boolean(error),
      ),
    [chartDetail?.validationErrors],
  );

  const previewChartDataProfile = useMemo(
    () =>
      (
        (previewDataResult.data?.previewData || {}) as {
          chartDataProfile?: Record<string, unknown>;
        }
      ).chartDataProfile,
    [previewDataResult.data],
  );
  const hasServerShaping = Boolean(
    chartDetail?.chartDataProfile || previewChartDataProfile,
  );

  useEffect(() => {
    form.setFieldsValue(chartOptionValues);
  }, [chartOptionValues]);

  const isAdjusted = useMemo(() => {
    return newValues !== null && !isEqual(chartOptionValues, newValues);
  }, [chartOptionValues, newValues]);

  const dataValues = useMemo(() => {
    const previewPayload = (previewDataResult.data?.previewData || {}) as {
      data?: unknown[][];
      columns?: Array<{ name: string; type: string }>;
    };
    const { data, columns } = previewPayload;
    return (data || []).map((val: unknown[]) => {
      const row = (columns || []).reduce<Record<string, unknown>>(
        (acc, col, index) => {
          acc[col.name] = val[index];
          return acc;
        },
        {},
      );

      if (!chartDataFields.length) {
        return row;
      }

      const alignedRow: Record<string, unknown> = { ...row };
      chartDataFields.forEach((targetField) => {
        if (alignedRow[targetField] !== undefined) return;
        const matchedColumn = (columns || []).find((col) =>
          isCompatibleFieldName(targetField, col.name),
        );
        if (!matchedColumn) return;
        alignedRow[targetField] = row[matchedColumn.name];
      });
      return alignedRow;
    });
  }, [chartDataFields, previewDataResult.data]);

  const dataColumns = useMemo(() => {
    const { columns } = (previewDataResult.data?.previewData || {}) as {
      columns?: Array<{ name: string; type: string }>;
    };
    return columns || [];
  }, [previewDataResult.data]);

  const loading =
    previewDataResult.loading ||
    !getIsChartFinished(effectiveChartStatus) ||
    regenerating;

  const DynamicProperties = getDynamicProperties(chartType as ChartType | null);

  const onFormChange = () => {
    setNewValues(form.getFieldsValue() as Record<string, unknown>);
  };

  const onChartTypeChange = (nextChartType: ChartType) => {
    form.setFieldsValue({ chartType: nextChartType });
    onFormChange();
  };

  const onRegenerate = () => {
    attachLoading(onGenerateChartAnswer, setRegenerating)(threadResponse.id);
    onResetState();
  };

  const onResetState = () => {
    setIsEditMode(false);
    setNewValues(null);
    form.resetFields();
  };

  const onReload = () => {
    Modal.confirm({
      title: '确认重新生成图表吗？',
      okText: '重新生成',
      cancelText: '取消',
      onOk: onRegenerate,
    });
  };

  const onEdit = () => {
    setIsEditMode(!isEditMode);
  };

  const onPin = () => {
    setIsPinModalOpen(true);
  };

  const onResetAdjustment = () => {
    setNewValues(null);
    form.resetFields();
  };

  const onAdjustChart = async () => {
    attachLoading(onAdjustChartAnswer, setRegenerating)(
      threadResponse.id,
      form.getFieldsValue(),
    );
    onResetState();
  };

  const regenerateBtn = (
    <div className="text-center mt-4">
      <ResultActionButton icon={<ReloadOutlined />} onClick={onReload}>
        重新生成
      </ResultActionButton>
    </div>
  );

  const answerErrorMessage = resolveAbortSafeErrorMessage(
    error?.message,
    '图表生成失败，请稍后重试。',
  );
  const answerShortMessage =
    resolveAbortSafeErrorMessage(error?.shortMessage, answerErrorMessage || '') ||
    '图表生成失败';
  const previewErrorMessage = resolveAbortSafeErrorMessage(
    previewDataResult.error,
    '加载图表数据失败，请稍后重试。',
  );

  if (error && answerErrorMessage) {
    return (
      <div className="p-6">
        <Alert
          message={answerShortMessage}
          description={answerErrorMessage}
          type="error"
          showIcon
        />
        {regenerateBtn}
      </div>
    );
  }

  if (previewDataResult.error && previewErrorMessage) {
    return (
      <div className="p-6">
        <Alert
          message="图表数据加载失败"
          description={previewErrorMessage}
          type="error"
          showIcon
        />
        {regenerateBtn}
      </div>
    );
  }

  const chartRegenerateBtn = adjustment ? regenerateBtn : null;

  return (
    <StyledSkeleton
      active
      loading={loading}
      paragraph={{ rows: 4 }}
      title={false}
    >
      <div className="text-md gray-10 p-6">
        {localizedChartDescription}
        {validationErrors.length > 0 ? (
          <Alert
            className="mt-4"
            type="warning"
            showIcon
            message="图表已按兼容模式渲染"
            description={
              <ul className="mb-0 pl-4">
                {validationErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            }
          />
        ) : null}
        {chartSpec ? (
          <ChartWrapper
            className={clsx(
              'border border-gray-4 rounded mt-4 pb-3 overflow-hidden',
              { isEditMode: isEditMode },
            )}
          >
            <Toolbar className={clsx({ isEditMode: isEditMode })}>
              <Form
                size="small"
                style={{ width: '100%' }}
                form={form}
                initialValues={chartOptionValues}
                onFieldsChange={onFormChange}
              >
                <div className="d-flex justify-content-between align-center">
                  <div className="flex-grow-1">
                    <DynamicProperties
                      columns={dataColumns}
                      titleMap={chartSpecFieldTitleMap}
                      onChartTypeChange={onChartTypeChange}
                    />
                  </div>
                  {isAdjusted && (
                    <div className="d-flex flex-column">
                      <ResultActionButton
                        className="ml-4 mb-2"
                        onClick={onResetAdjustment}
                      >
                        重置
                      </ResultActionButton>
                      <ResultActionButton
                        className="ml-4"
                        type="primary"
                        onClick={onAdjustChart}
                      >
                        应用调整
                      </ResultActionButton>
                    </div>
                  )}
                </div>
              </Form>
            </Toolbar>
            <Chart
              width={700}
              spec={chartSpec}
              values={dataValues}
              onEdit={onEdit}
              onReload={onReload}
              onPin={onPin}
              preferredRenderer={preferredRenderer}
              cacheKey={`response:${threadResponse.id}:${
                chartDetail?.canonicalizationVersion || 'legacy'
              }`}
              serverShaped={hasServerShaping}
            />
          </ChartWrapper>
        ) : (
          chartRegenerateBtn
        )}
      </div>
      <Modal
        title="固定到看板"
        visible={isPinModalOpen}
        onCancel={() => {
          setIsPinModalOpen(false);
          setPinTargetDashboardId(null);
        }}
        confirmLoading={pinSubmitting}
        okText="固定"
        cancelText="取消"
        onOk={async () => {
          setPinSubmitting(true);
          try {
            const itemType = String(
              chartType || chartOptionValues.chartType || '',
            ).toUpperCase() as DashboardItemType;
            if (!Object.values(DashboardItemType).includes(itemType)) {
              throw new Error('当前图表类型暂不支持固定到看板。');
            }

            const payload = await createDashboardItem(
              runtimeScopeNavigation.selector,
              {
                itemType,
                responseId: threadResponse.id,
                ...(pinTargetDashboardId != null
                  ? { dashboardId: pinTargetDashboardId }
                  : {}),
              },
            );
            const targetDashboard = dashboardOptions.find(
              (dashboard) => dashboard.id === payload.dashboardId,
            );
            message.success(
              targetDashboard
                ? `已固定到看板「${targetDashboard.name}」`
                : '已固定到默认看板。',
            );
            setIsPinModalOpen(false);
            setPinTargetDashboardId(null);
          } catch (error) {
            const errorMessage = resolveAbortSafeErrorMessage(
              error,
              '固定到看板失败。',
            );
            if (errorMessage) {
              message.error(errorMessage);
            }
            return;
          } finally {
            setPinSubmitting(false);
          }
        }}
      >
        <div className="gray-7" style={{ marginBottom: 12 }}>
          可选目标看板；如果不选择，将加入当前作用域下的默认看板。固定后，你可以在看板页回到来源线程继续追问。
        </div>
        <Select
          allowClear
          style={{ width: '100%' }}
          placeholder="不指定目标看板"
          loading={dashboardsLoading}
          value={pinTargetDashboardId ?? undefined}
          onChange={(value?: number) => setPinTargetDashboardId(value ?? null)}
          options={dashboardOptions.map((dashboard) => ({
            label: dashboard.name,
            value: dashboard.id,
          }))}
        />
      </Modal>
    </StyledSkeleton>
  );
}
