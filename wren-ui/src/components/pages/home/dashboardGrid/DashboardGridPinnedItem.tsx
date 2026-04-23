import dynamic from 'next/dynamic';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, Button } from 'antd';

import { appMessage as message } from '@/utils/antdAppBridge';
import { LoadingWrapper } from '@/components/PageLoading';
import { DashboardItemDropdown } from '@/components/diagram/CustomDropdown';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { MORE_ACTION } from '@/utils/enum';
import { MoreIcon } from '@/utils/icons';
import { getCompactTime, nextTick } from '@/utils/time';
import {
  previewDashboardItem,
  type DashboardPreviewData,
} from '@/utils/dashboardRest';

import { DashboardGridPinnedItemTitle } from './DashboardGridPinnedItemTitle';
import type {
  DashboardGridItem,
  DashboardGridPinnedItemHandle,
} from './dashboardGridTypes';

const Chart = dynamic(() => import('@/components/chart'), {
  ssr: false,
});

const toPreferredRenderer = (value: unknown): 'svg' | 'canvas' | undefined =>
  value === 'svg' || value === 'canvas' ? value : undefined;

export const DashboardGridPinnedItem = forwardRef(
  (
    props: {
      item: DashboardGridItem;
      isSupportCached: boolean;
      readOnly?: boolean;
      runtimeScopeSelector: ClientRuntimeScopeSelector;
      onDelete: (id: number) => Promise<void>;
      onItemUpdated: (item: DashboardGridItem) => void;
      onNavigateToThread: (
        threadId?: number | null,
        responseId?: number | null,
      ) => Promise<void>;
    },
    ref: React.ForwardedRef<DashboardGridPinnedItemHandle>,
  ) => {
    const {
      item,
      isSupportCached,
      readOnly = false,
      runtimeScopeSelector,
      onDelete,
      onItemUpdated,
      onNavigateToThread,
    } = props;
    const { detail } = item;
    const [isHideLegend, setIsHideLegend] = useState(true);
    const [forceLoading, setForceLoading] = useState(false);
    const [forceUpdate, setForceUpdate] = useState(0);
    const [previewItem, setPreviewItem] = useState<DashboardPreviewData | null>(
      null,
    );
    const [previewLoading, setPreviewLoading] = useState(false);
    const previewRequestIdRef = useRef(0);

    const loadPreview = useCallback(
      async ({ refresh = false }: { refresh?: boolean } = {}) => {
        if (readOnly) {
          setPreviewItem(null);
          setPreviewLoading(false);
          return null;
        }

        const requestId = previewRequestIdRef.current + 1;
        previewRequestIdRef.current = requestId;
        setPreviewLoading(true);

        try {
          const payload = await previewDashboardItem(
            runtimeScopeSelector,
            item.id,
            refresh ? { refresh: isSupportCached } : {},
          );

          if (previewRequestIdRef.current === requestId) {
            setPreviewItem(payload);
          }

          return payload;
        } catch (error) {
          if (previewRequestIdRef.current === requestId) {
            setPreviewItem(null);
          }
          message.error(
            error instanceof Error
              ? error.message
              : '加载看板图表失败，请稍后重试。',
          );
          return null;
        } finally {
          if (previewRequestIdRef.current === requestId) {
            setPreviewLoading(false);
          }
        }
      },
      [isSupportCached, item.id, readOnly, runtimeScopeSelector],
    );

    useImperativeHandle(
      ref,
      () => ({
        onRefresh: () => {
          if (readOnly) {
            return;
          }
          void loadPreview({ refresh: true });
        },
      }),
      [loadPreview, readOnly],
    );

    const lastRefreshTime =
      previewItem?.cacheOverrodeAt || previewItem?.cacheCreatedAt;

    useEffect(() => {
      if (readOnly) {
        previewRequestIdRef.current += 1;
        setPreviewItem(null);
        setPreviewLoading(false);
        return;
      }
      void loadPreview();
    }, [
      detail.canonicalizationVersion,
      detail.sql,
      item.id,
      loadPreview,
      readOnly,
    ]);

    useEffect(() => {
      setForceLoading(true);
      nextTick(200).then(() => {
        setForceUpdate((prev) => prev + 1);
        setForceLoading(false);
      });
    }, [item.layout]);

    const title = useMemo(
      () => item.displayName || item.detail?.chartSchema?.title || '',
      [item.displayName, item.detail?.chartSchema?.title],
    );

    const onMoreClick = async (
      payload: MORE_ACTION | { type: MORE_ACTION; data: unknown },
    ) => {
      const action =
        typeof payload === 'object' && payload !== null
          ? payload.type
          : payload;
      if (action === MORE_ACTION.DELETE) {
        await onDelete(item.id);
      } else if (action === MORE_ACTION.REFRESH) {
        if (readOnly) {
          return;
        }
        await loadPreview({ refresh: true });
      } else if (action === MORE_ACTION.HIDE_CATEGORY) {
        setIsHideLegend((prev) => !prev);
        setForceUpdate((prev) => prev + 1);
      }
    };

    const loading = readOnly ? false : forceLoading || previewLoading;
    const validationErrors = (detail.validationErrors || []).filter(Boolean);

    return (
      <div className="adm-pinned-item">
        <div className="adm-pinned-item-header">
          <div
            className="adm-pinned-item-title"
            title={title}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <DashboardGridPinnedItemTitle
              id={item.id}
              title={title}
              readOnly={readOnly}
              runtimeScopeSelector={runtimeScopeSelector}
              onRename={onItemUpdated}
            />
          </div>

          <div className="adm-pinned-actions">
            {item.detail?.sourceThreadId != null ? (
              <Button
                type="text"
                size="small"
                onMouseDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void onNavigateToThread(
                    item.detail?.sourceThreadId,
                    item.detail?.sourceResponseId,
                  );
                }}
              >
                来源线程
              </Button>
            ) : null}
            <DashboardItemDropdown
              onMoreClick={onMoreClick}
              isHideLegend={isHideLegend}
              isSupportCached={isSupportCached}
              disableRefresh={readOnly}
              disableDelete={readOnly}
            >
              <Button
                className="adm-pinned-more gray-8"
                type="text"
                size="small"
                icon={<MoreIcon />}
                onMouseDown={(event) => event.stopPropagation()}
              />
            </DashboardItemDropdown>
          </div>
        </div>
        <div className="adm-pinned-content">
          <div className="adm-pinned-content-overflow adm-scrollbar-track">
            {validationErrors.length > 0 ? (
              <Alert
                style={{ marginBottom: 12 }}
                type="warning"
                showIcon
                title="图表已按兼容模式渲染"
                description={validationErrors[0]}
              />
            ) : null}
            <LoadingWrapper loading={loading} tip="图表加载中…">
              {readOnly ? (
                <Alert
                  showIcon
                  type="info"
                  title="历史快照下不支持执行看板查询。"
                />
              ) : (
                <Chart
                  className="adm-pinned-item-chart"
                  width="100%"
                  height="100%"
                  spec={detail.chartSchema}
                  preferredRenderer={toPreferredRenderer(
                    detail.renderHints?.preferredRenderer,
                  )}
                  values={previewItem?.data}
                  forceUpdate={forceUpdate}
                  autoFilter={
                    !(previewItem?.chartDataProfile || detail.chartDataProfile)
                  }
                  hideActions
                  hideTitle
                  hideLegend={isHideLegend}
                  isPinned
                  cacheKey={`dashboard-item:${item.id}:${
                    detail.canonicalizationVersion || 'legacy'
                  }`}
                  serverShaped={Boolean(
                    previewItem?.chartDataProfile || detail.chartDataProfile,
                  )}
                />
              )}
            </LoadingWrapper>
          </div>
          {lastRefreshTime && (
            <div className="adm-pinned-content-info">
              {detail.canonicalizationVersion ? (
                <span style={{ marginRight: 8 }}>
                  {detail.canonicalizationVersion}
                </span>
              ) : null}
              最近刷新：{getCompactTime(lastRefreshTime)}
            </div>
          )}
        </div>
      </div>
    );
  },
);
