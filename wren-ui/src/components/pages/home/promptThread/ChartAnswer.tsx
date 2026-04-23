import clsx from 'clsx';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Form } from 'antd';
import { attachLoading } from '@/utils/helper';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import { ChartType, DashboardItemType } from '@/types/home';
import { Props as AnswerResultProps } from '@/components/pages/home/promptThread/AnswerResult';
import { isEmpty, isEqual } from 'lodash';
import {
  getChartSpecFieldTitleMap,
  getChartSpecOptionValues,
} from '@/components/chart/meta';
import {
  createDashboard,
  loadDashboardDetailPayload,
  loadDashboardListPayload,
  resolveDashboardDisplayName,
  type DashboardListItem,
} from '@/utils/dashboardRest';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { usePromptThreadActionsStore } from './store';
import useResponsePreviewData from '@/hooks/useResponsePreviewData';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { createDashboardItem } from '@/utils/homeRest';
import {
  ChartWrapper,
  ResultActionButton,
  StyledSkeleton,
  Toolbar,
} from './chartAnswerStyles';
import ChartAnswerPinModal from './ChartAnswerPinModal';
import ChartAnswerPinPopover from './ChartAnswerPinPopover';
import {
  getDynamicProperties,
  getIsChartFinished,
  isCompatibleFieldName,
  toPreferredRenderer,
} from './chartAnswerUtils';
import { appMessage, appModal } from '@/utils/antdAppBridge';
import { resolveThreadResponseRuntimeSelector } from '@/features/home/thread/threadResponseRuntime';
import { getThreadWorkbenchMessages } from '@/features/home/thread/threadWorkbenchMessages';

const Chart = dynamic(() => import('@/components/chart'), { ssr: false });

type DashboardOption = Pick<
  DashboardListItem,
  'id' | 'isDefault' | 'name' | 'cacheEnabled' | 'scheduleFrequency'
>;

const sortDashboardOptions = (dashboards: DashboardOption[]) =>
  [...dashboards].sort((left, right) => {
    const leftIsDefault = Boolean(left.isDefault);
    const rightIsDefault = Boolean(right.isDefault);
    if (leftIsDefault !== rightIsDefault) {
      return leftIsDefault ? -1 : 1;
    }
    return left.id - right.id;
  });

export default function ChartAnswer(props: AnswerResultProps) {
  const { onGenerateChartAnswer, onAdjustChartAnswer } =
    usePromptThreadActionsStore();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const { mode, shouldAutoPreview, threadResponse } = props;
  const messages = getThreadWorkbenchMessages();
  const responseRuntimeSelector = resolveThreadResponseRuntimeSelector({
    response: threadResponse,
    fallbackSelector: runtimeScopeNavigation.selector,
  });
  const isWorkbenchMode = mode === 'workbench';
  const [regenerating, setRegenerating] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [newValues, setNewValues] = useState<Record<string, unknown> | null>(
    null,
  );
  const [hasRequestedPreview, setHasRequestedPreview] = useState(false);
  const [isPinPopoverOpen, setIsPinPopoverOpen] = useState(false);
  const [isCreatePinModalOpen, setIsCreatePinModalOpen] = useState(false);

  const [form] = Form.useForm();
  const chartType = Form.useWatch('chartType', form);
  const { chartDetail } = threadResponse;
  const { error, status, adjustment } = chartDetail || {};
  const effectiveChartStatus = status || null;

  const previewDataResult = useResponsePreviewData(
    threadResponse.id,
    responseRuntimeSelector,
  );
  const { ensureLoaded: ensurePreviewLoaded } = previewDataResult;
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [dashboardOptions, setDashboardOptions] = useState<DashboardOption[]>(
    [],
  );
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [createAndPinSubmitting, setCreateAndPinSubmitting] = useState(false);

  const refreshDashboardOptions = useCallback(
    async (useCache: boolean) => {
      setDashboardsLoading(true);
      try {
        const payload = await loadDashboardListPayload({
          selector: runtimeScopeNavigation.workspaceSelector,
          useCache,
        });
        const nextOptions = sortDashboardOptions(payload);
        setDashboardOptions(nextOptions);
        return nextOptions;
      } catch (error) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '加载看板列表失败。',
        );
        if (errorMessage) {
          appMessage.error(errorMessage);
        }
        setDashboardOptions([]);
        return [] as DashboardOption[];
      } finally {
        setDashboardsLoading(false);
      }
    },
    [runtimeScopeNavigation.workspaceSelector],
  );

  useEffect(() => {
    let cancelled = false;
    setDashboardsLoading(true);

    void loadDashboardListPayload({
      selector: runtimeScopeNavigation.workspaceSelector,
      useCache: true,
    })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setDashboardOptions(sortDashboardOptions(payload));
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
          appMessage.error(errorMessage);
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
  }, [runtimeScopeNavigation.workspaceSelector]);

  const chartSpec = useMemo(() => {
    if (
      !chartDetail?.chartSchema ||
      (getIsChartFinished(effectiveChartStatus) &&
        isEmpty(chartDetail?.chartSchema))
    )
      return null;
    return chartDetail.chartSchema;
  }, [chartDetail, effectiveChartStatus]);

  const shouldRequestPreview =
    shouldAutoPreview || !!chartSpec || isWorkbenchMode;

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
        appMessage.error(errorMessage);
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
    return chartDetail?.description?.trim() || '';
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
    [chartDetail?.renderHints?.preferredRenderer],
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

  useEffect(() => form.setFieldsValue(chartOptionValues), [chartOptionValues]);

  const isAdjusted = useMemo(
    () => newValues !== null && !isEqual(chartOptionValues, newValues),
    [chartOptionValues, newValues],
  );

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
    appModal.confirm({
      title: '确认重新生成图表吗？',
      okText: '重新生成',
      cancelText: '取消',
      onOk: onRegenerate,
    });
  };

  const onEdit = () => setIsEditMode(!isEditMode);

  const submitPinToDashboard = async (
    targetDashboardId: number | null,
    targetDashboardName?: string | null,
  ) => {
    const itemType = String(
      chartType || chartOptionValues.chartType || '',
    ).toUpperCase() as DashboardItemType;
    if (!Object.values(DashboardItemType).includes(itemType)) {
      throw new Error('当前图表类型暂不支持固定到看板。');
    }

    const payload = await createDashboardItem(responseRuntimeSelector, {
      itemType,
      responseId: threadResponse.id,
      ...(targetDashboardId != null ? { dashboardId: targetDashboardId } : {}),
    });
    await loadDashboardDetailPayload({
      dashboardId: payload.dashboardId,
      selector: runtimeScopeNavigation.workspaceSelector,
      useCache: false,
    });
    const targetDashboard = dashboardOptions.find(
      (dashboard) => dashboard.id === payload.dashboardId,
    );
    appMessage.success(
      targetDashboardName
        ? `已固定到看板「${resolveDashboardDisplayName(targetDashboardName)}」`
        : targetDashboard
          ? `已固定到看板「${resolveDashboardDisplayName(targetDashboard.name)}」`
          : '已固定到当前工作空间的默认看板。',
    );
    setIsPinPopoverOpen(false);
    setIsCreatePinModalOpen(false);
  };

  const shouldUsePinPopover = dashboardOptions.length !== 1;
  const pinActionDisabled = pinSubmitting || createAndPinSubmitting;

  const runPinToDashboard = async (
    targetDashboardId: number | null,
    targetDashboardName?: string | null,
  ) => {
    setPinSubmitting(true);
    try {
      await submitPinToDashboard(targetDashboardId, targetDashboardName);
    } catch (error) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '固定到看板失败。',
      );
      if (errorMessage) {
        appMessage.error(errorMessage);
      }
    } finally {
      setPinSubmitting(false);
    }
  };

  const onPin = async () => {
    if (pinActionDisabled) {
      return;
    }

    const latestDashboardOptions = await refreshDashboardOptions(false);
    const latestDefaultDashboardOption =
      latestDashboardOptions.find((dashboard) => dashboard.isDefault) ||
      latestDashboardOptions[0] ||
      null;

    if (latestDashboardOptions.length === 1) {
      await runPinToDashboard(
        latestDefaultDashboardOption?.id ?? null,
        latestDefaultDashboardOption?.name,
      );
      return;
    }

    setIsPinPopoverOpen(true);
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
    resolveAbortSafeErrorMessage(
      error?.shortMessage,
      answerErrorMessage || '',
    ) || '图表生成失败';
  const previewErrorMessage = resolveAbortSafeErrorMessage(
    previewDataResult.error,
    '加载图表数据失败，请稍后重试。',
  );

  if (error && answerErrorMessage) {
    return (
      <div className="p-6">
        <Alert
          title={answerShortMessage}
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
          title="图表数据加载失败"
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
            title="图表已按兼容模式渲染"
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
              width={isWorkbenchMode ? '100%' : 700}
              spec={chartSpec}
              values={dataValues}
              hideEditAction
              hideReloadAction
              onEdit={onEdit}
              onReload={onReload}
              onPin={onPin}
              pinButtonLabel={messages.headerActions.pinDashboard}
              pinDisabled={pinActionDisabled}
              pinPopoverContent={
                shouldUsePinPopover ? (
                  <ChartAnswerPinPopover
                    dashboardsLoading={dashboardsLoading}
                    dashboardOptions={dashboardOptions}
                    disabled={pinActionDisabled}
                    onCreateAndPin={() => {
                      setIsPinPopoverOpen(false);
                      setIsCreatePinModalOpen(true);
                    }}
                    onSelectDashboard={async (dashboardId, dashboardName) => {
                      setIsPinPopoverOpen(false);
                      await runPinToDashboard(dashboardId, dashboardName);
                    }}
                  />
                ) : undefined
              }
              pinPopoverOpen={
                shouldUsePinPopover ? isPinPopoverOpen : undefined
              }
              onPinPopoverOpenChange={
                shouldUsePinPopover
                  ? (open) => {
                      if (pinActionDisabled) {
                        return;
                      }
                      setIsPinPopoverOpen(open);
                    }
                  : undefined
              }
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
      <ChartAnswerPinModal
        open={isCreatePinModalOpen}
        submitting={createAndPinSubmitting}
        onCancel={() => {
          setIsCreatePinModalOpen(false);
        }}
        onSubmit={async (dashboardName) => {
          const normalizedName = dashboardName.trim();
          if (!normalizedName) {
            appMessage.warning('请输入新看板名称。');
            return;
          }

          setCreateAndPinSubmitting(true);
          try {
            const dashboard = await createDashboard(
              runtimeScopeNavigation.workspaceSelector,
              {
                name: normalizedName,
              },
            );
            setDashboardOptions((previous) =>
              sortDashboardOptions([...previous, dashboard]),
            );
            await submitPinToDashboard(dashboard.id, dashboard.name);
          } catch (error) {
            const errorMessage = resolveAbortSafeErrorMessage(
              error,
              '新建看板并固定失败。',
            );
            if (errorMessage) {
              appMessage.error(errorMessage);
            }
          } finally {
            setCreateAndPinSubmitting(false);
          }
        }}
      />
    </StyledSkeleton>
  );
}

export { getIsChartFinished } from './chartAnswerUtils';
