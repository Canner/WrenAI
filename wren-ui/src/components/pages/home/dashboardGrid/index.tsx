import dynamic from 'next/dynamic';
import React, {
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useState,
  createRef,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { Alert, Button, Form, message } from 'antd';
import styled from 'styled-components';
import GridLayout, { Layout } from 'react-grid-layout';
import { MoreIcon } from '@/utils/icons';
import { MORE_ACTION } from '@/utils/enum';
import { getCompactTime, nextTick } from '@/utils/time';
import { LoadingWrapper } from '@/components/PageLoading';
import { DashboardItemDropdown } from '@/components/diagram/CustomDropdown';
import EditableWrapper, { EditableContext } from '@/components/EditableWrapper';
import type { ClientRuntimeScopeSelector } from '@/apollo/client/runtimeScope';
import {
  previewDashboardItem,
  updateDashboardItem,
  type DashboardGridItemData,
  type DashboardItemLayoutInput,
  type DashboardPreviewData,
} from '@/utils/dashboardRest';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const Chart = dynamic(() => import('@/components/chart'), {
  ssr: false,
});

const StyledDashboardGrid = styled.div`
  flex: 1;
  padding: 18px;

  .react-grid-layout {
    width: 100%;
    height: 100%;
  }

  .adm-pinned-item {
    cursor: grab;
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.98) 0%,
      rgba(248, 246, 251, 0.98) 100%
    );
    height: 100%;
    border-radius: 22px;
    border: 1px solid var(--nova-outline-soft);
    box-shadow: 0 20px 40px -28px rgba(31, 35, 50, 0.28);
    transition:
      border-color 0.2s ease,
      transform 0.2s ease,
      box-shadow 0.2s ease;

    &:hover {
      border-color: var(--nova-primary);
      transform: translateY(-1px);
      box-shadow: 0 24px 44px -28px rgba(31, 35, 50, 0.32);
    }
  }

  .adm-pinned-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 18px 16px 0 18px;
    * {
      min-width: 0;
    }
  }

  .adm-pinned-item-title {
    font-size: 14px;
    font-weight: 700;
    flex-grow: 1;
  }

  .adm-pinned-actions {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-shrink: 0;
  }

  .adm-pinned-content {
    height: calc(100% - 40px);
    padding: 16px 16px 18px;

    &-overflow {
      overflow: auto;
      height: calc(100% - 18px);
      padding: 8px 12px;
    }

    &-info {
      font-size: 12px;
      color: var(--gray-6);
      text-align: right;
      user-select: none;
    }
  }

  .adm-pinned-item-chart {
    height: 100%;
  }

  .react-grid-placeholder {
    background-color: rgba(141, 101, 225, 0.22);
    border-radius: 20px;
  }
`;

const GUTTER = 8;
const COLUMN_COUNT = 6;

const calculateColumnSize = (containerWidth: number) => {
  return (containerWidth - GUTTER * (COLUMN_COUNT - 1)) / COLUMN_COUNT;
};

const getLayoutToGrid = (item: DashboardGridItem) => {
  return {
    i: item.id.toString(),
    x: item.layout.x,
    y: item.layout.y,
    w: item.layout.w,
    h: item.layout.h,
  };
};

const getLayoutToUpdateItem = (layout: Layout) => {
  return {
    itemId: Number(layout.i),
    x: layout.x,
    y: layout.y,
    w: layout.w,
    h: layout.h,
  };
};

export type DashboardGridItem = DashboardGridItemData;

const toPreferredRenderer = (value: unknown): 'svg' | 'canvas' | undefined =>
  value === 'svg' || value === 'canvas' ? value : undefined;

interface Props {
  items: DashboardGridItem[];
  isSupportCached: boolean;
  readOnly?: boolean;
  runtimeScopeSelector: ClientRuntimeScopeSelector;
  onUpdateChange: (layouts: DashboardItemLayoutInput[]) => void;
  onDelete: (id: number) => Promise<void>;
  onItemUpdated: (item: DashboardGridItem) => void;
  onNavigateToThread: (
    threadId?: number | null,
    responseId?: number | null,
  ) => Promise<void>;
}

export interface DashboardGridHandle {
  onRefreshAll: () => void;
  focusItem: (id: number) => void;
}

const DashboardGrid = forwardRef(
  (props: Props, ref: React.Ref<DashboardGridHandle>) => {
    const {
      items,
      isSupportCached,
      readOnly = false,
      runtimeScopeSelector,
      onUpdateChange,
      onDelete,
      onItemUpdated,
      onNavigateToThread,
    } = props;
    const itemRefs = useRef<{
      [key: string]: React.RefObject<{ onRefresh: () => void }>;
    }>({});
    const itemNodes = useRef<Record<string, HTMLDivElement | null>>({});
    const $container = useRef<HTMLDivElement>(null);
    const [gridWidth, setGridWidth] = useState(1200);

    // set up initial item refs
    useEffect(() => {
      items.forEach((item) => {
        itemRefs.current[item.id] = createRef();
      });
    }, [items]);

    useImperativeHandle(
      ref,
      () => ({
        onRefreshAll: () => {
          Object.values(itemRefs.current).forEach((itemRef) => {
            itemRef.current?.onRefresh();
          });
        },
        focusItem: (id: number) => {
          const node = itemNodes.current[String(id)];
          if (!node) {
            return;
          }

          node.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
            inline: 'nearest',
          });

          const itemElement = node.querySelector(
            '.adm-pinned-item',
          ) as HTMLElement | null;
          if (itemElement) {
            itemElement.style.borderColor = 'var(--nova-primary)';
            window.setTimeout(() => {
              itemElement.style.borderColor = '';
            }, 1400);
          }
        },
      }),
      [items],
    );

    const layouts = useMemo(() => {
      if (items.length === 1) {
        const item = items[0];
        return [
          {
            ...getLayoutToGrid(item),
            x: 0,
            y: 0,
            w: COLUMN_COUNT,
            h: Math.max(item.layout.h, 3),
          },
        ];
      }

      return items.map((item) => getLayoutToGrid(item));
    }, [items]);

    const getGridItemLayouts = () =>
      items.map((item) => {
        return (
          <div
            key={item.id}
            ref={(node) => {
              itemNodes.current[String(item.id)] = node;
            }}
            data-dashboard-item-id={item.id}
          >
            <PinnedItem
              ref={itemRefs.current[item.id]}
              isSupportCached={isSupportCached}
              readOnly={readOnly}
              runtimeScopeSelector={runtimeScopeSelector}
              item={item}
              onDelete={onDelete}
              onItemUpdated={onItemUpdated}
              onNavigateToThread={onNavigateToThread}
            />
          </div>
        );
      });

    useEffect(() => {
      const container = $container.current;
      if (!container) {
        return;
      }

      const renderGridWidth = () => {
        const measuredWidth = Math.max(container.clientWidth, 960);
        container.style.minWidth = `${measuredWidth}px`;
        setGridWidth(measuredWidth);
      };

      renderGridWidth();
      const resizeObserver =
        typeof ResizeObserver !== 'undefined'
          ? new ResizeObserver(() => renderGridWidth())
          : null;
      resizeObserver?.observe(container);
      window.addEventListener('resize', renderGridWidth);
      return () => {
        resizeObserver?.disconnect();
        window.removeEventListener('resize', renderGridWidth);
      };
    }, [$container]);

    const onLayoutChange = (layouts: Layout[]) => {
      if (readOnly) {
        return;
      }
      onUpdateChange(layouts.map((layout) => getLayoutToUpdateItem(layout)));
    };

    return (
      <StyledDashboardGrid ref={$container}>
        <GridLayout
          layout={layouts}
          cols={COLUMN_COUNT}
          margin={[GUTTER, GUTTER]}
          containerPadding={[0, 0]}
          rowHeight={calculateColumnSize(gridWidth)}
          width={gridWidth}
          isDraggable={!readOnly}
          isResizable={!readOnly}
          onLayoutChange={onLayoutChange}
        >
          {getGridItemLayouts()}
        </GridLayout>
      </StyledDashboardGrid>
    );
  },
);

export default DashboardGrid;

const PinnedItemTitle = (props: {
  id: number;
  title: string;
  readOnly?: boolean;
  runtimeScopeSelector: ClientRuntimeScopeSelector;
  onRename: (item: DashboardGridItem) => void;
}) => {
  const { title, readOnly = false, runtimeScopeSelector, onRename } = props;
  const [form] = Form.useForm();

  const handleSave = (
    dashboardItemId: string | number,
    values: { [key: string]: string },
  ) => {
    const nextTitle = values.title?.trim();
    if (!nextTitle || nextTitle === title) return;

    void updateDashboardItem(runtimeScopeSelector, Number(dashboardItemId), {
      displayName: nextTitle,
    })
      .then((item) => {
        onRename(item);
      })
      .catch((error) => {
        message.error(
          error instanceof Error
            ? error.message
            : '更新看板图表失败，请稍后重试。',
        );
      });
  };

  return (
    <EditableContext.Provider value={form}>
      {readOnly ? (
        <div
          className="editable-cell-value-wrap"
          style={{
            padding: '0 7px',
            border: '1px var(--gray-4) solid',
            borderRadius: 4,
          }}
        >
          {title}
        </div>
      ) : (
        <Form className="d-flex" form={form}>
          <EditableWrapper
            record={props}
            dataIndex="title"
            handleSave={handleSave}
          >
            {title}
          </EditableWrapper>
        </Form>
      )}
    </EditableContext.Provider>
  );
};

const PinnedItem = forwardRef(
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
    ref: React.ForwardedRef<{ onRefresh: () => void }>,
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

    const title = useMemo(() => {
      return item.displayName || item.detail?.chartSchema?.title || '';
    }, [item.displayName, item.detail?.chartSchema?.title]);

    const onHideLegend = () => {
      setIsHideLegend(!isHideLegend);
      setForceUpdate((prev) => prev + 1);
    };

    const onMoreClick = async (
      payload: MORE_ACTION | { type: MORE_ACTION; data: any },
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
        onHideLegend();
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
            onMouseDown={(e) => e.stopPropagation()}
          >
            <PinnedItemTitle
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
                onMouseDown={(e) => e.stopPropagation()}
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
                message="图表已按兼容模式渲染"
                description={validationErrors[0]}
              />
            ) : null}
            <LoadingWrapper loading={loading} tip="图表加载中…">
              {readOnly ? (
                <Alert
                  showIcon
                  type="info"
                  message="历史快照下不支持执行看板查询。"
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
