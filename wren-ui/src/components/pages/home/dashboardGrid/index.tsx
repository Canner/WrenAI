import dynamic from 'next/dynamic';
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  createRef,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { Button, Form } from 'antd';
import styled from 'styled-components';
import GridLayout, { Layout } from 'react-grid-layout';
import { MoreIcon } from '@/utils/icons';
import { MORE_ACTION } from '@/utils/enum';
import { getCompactTime, nextTick } from '@/utils/time';
import { LoadingWrapper } from '@/components/PageLoading';
import { DashboardItemDropdown } from '@/components/diagram/CustomDropdown';
import EditableWrapper, { EditableContext } from '@/components/EditableWrapper';
import {
  DashboardItem,
  ItemLayoutInput,
} from '@/apollo/client/graphql/__types__';
import {
  usePreviewItemSqlMutation,
  useUpdateDashboardItemMutation,
} from '@/apollo/client/graphql/dashboard.generated';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const Chart = dynamic(() => import('@/components/chart'), {
  ssr: false,
});

const StyledDashboardGrid = styled.div`
  flex: 1;
  padding: 16px;

  .react-grid-layout {
    width: 100%;
    height: 100%;
  }

  .adm-pinned-item {
    cursor: grab;
    background-color: white;
    height: 100%;
    border-radius: 4px;
    border: 2px solid transparent;
    box-shadow: rgba(45, 62, 80, 0.12) 0px 1px 5px 0px;
    transition: border-color 0.2s ease;

    &:hover {
      border-color: var(--geekblue-6);
    }
  }

  .adm-pinned-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 8px 0 16px;
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
    padding: 16px 12px 16px;

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
    background-color: var(--blue-6);
  }
`;

const GUTTER = 8;
const COLUMN_COUNT = 6;

const calculateLayoutWidth = (itemWidth: number) => {
  return itemWidth * COLUMN_COUNT + GUTTER * COLUMN_COUNT;
};

const calculateColumnSize = (containerWidth: number) => {
  return (containerWidth - GUTTER * COLUMN_COUNT) / COLUMN_COUNT;
};

const getLayoutToGrid = (item: DashboardItem) => {
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

interface Props {
  items: DashboardItem[];
  isSupportCached: boolean;
  onUpdateChange: (layouts: ItemLayoutInput[]) => void;
  onDelete: (id: number) => Promise<void>;
}

const DashboardGrid = forwardRef(
  (props: Props, ref: React.RefObject<{ onRefreshAll: () => void }>) => {
    const { items, isSupportCached, onUpdateChange, onDelete } = props;
    const itemRefs = useRef<{
      [key: string]: React.RefObject<{ onRefresh: () => void }>;
    }>({});
    const $container = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState(250);

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
      }),
      [items],
    );

    const layouts = useMemo(() => {
      return items.map((item) => getLayoutToGrid(item));
    }, [items]);

    const getGridItemLayouts = () =>
      items.map((item) => {
        return (
          <div key={item.id}>
            <PinnedItem
              ref={itemRefs.current[item.id]}
              isSupportCached={isSupportCached}
              item={item}
              onDelete={onDelete}
            />
          </div>
        );
      });

    useEffect(() => {
      const renderColumnSize = () => {
        if (!$container.current) return;
        const sidebarWidth = 280;
        const padding = 16 * 2;
        const containerWidth = window.innerWidth - sidebarWidth - padding;

        const minContainerWidth = 1024;
        let calculatedWidth = containerWidth;
        if (containerWidth <= minContainerWidth) {
          calculatedWidth = minContainerWidth;
          $container.current.style.minWidth = `${minContainerWidth + padding}px`;
        } else {
          $container.current.style.minWidth = '100%';
        }

        const columnSize = calculateColumnSize(calculatedWidth);
        setSize(columnSize);
      };
      renderColumnSize();
      window.addEventListener('resize', renderColumnSize);
      return () => {
        window.removeEventListener('resize', renderColumnSize);
      };
    }, [$container]);

    const onLayoutChange = (layouts: Layout[]) => {
      onUpdateChange(layouts.map((layout) => getLayoutToUpdateItem(layout)));
    };

    return (
      <StyledDashboardGrid ref={$container}>
        <GridLayout
          layout={layouts}
          cols={COLUMN_COUNT}
          margin={[GUTTER, GUTTER]}
          containerPadding={[0, 0]}
          rowHeight={size}
          width={calculateLayoutWidth(size)}
          onLayoutChange={onLayoutChange}
        >
          {getGridItemLayouts()}
        </GridLayout>
      </StyledDashboardGrid>
    );
  },
);

export default DashboardGrid;

const PinnedItemTitle = (props: { id: number; title: string }) => {
  const { title } = props;
  const [form] = Form.useForm();

  const [updateDashboardItem] = useUpdateDashboardItemMutation({
    onError: (error) => console.error(error),
  });

  const handleSave = (dashboardItemId: number, values: { title: string }) => {
    if (values.title === title) return;
    updateDashboardItem({
      variables: {
        where: { id: dashboardItemId },
        data: {
          displayName: values.title.trim(),
        },
      },
    });
  };

  return (
    <EditableContext.Provider value={form}>
      <Form className="d-flex" form={form}>
        <EditableWrapper
          record={props}
          dataIndex="title"
          handleSave={handleSave}
        >
          {title}
        </EditableWrapper>
      </Form>
    </EditableContext.Provider>
  );
};

const PinnedItem = forwardRef(
  (
    props: {
      item: DashboardItem;
      isSupportCached: boolean;
      onDelete: (id: number) => Promise<void>;
    },
    ref: React.RefObject<{ onRefresh: () => void }>,
  ) => {
    const { item, isSupportCached, onDelete } = props;
    const { detail } = item;
    const [isHideLegend, setIsHideLegend] = useState(true);
    const [forceLoading, setForceLoading] = useState(false);
    const [forceUpdate, setForceUpdate] = useState(0);

    useImperativeHandle(
      ref,
      () => ({
        onRefresh: () => {
          previewItemSQL({
            variables: { data: { itemId: item.id, refresh: isSupportCached } },
          });
        },
      }),
      [item.id],
    );

    const [previewItemSQL, previewItemSQLResult] = usePreviewItemSqlMutation({
      onError: (error) => console.error(error),
    });
    const previewItem = previewItemSQLResult.data?.previewItemSQL;
    const lastRefreshTime =
      previewItem?.cacheOverrodeAt || previewItem?.cacheCreatedAt;

    useEffect(() => {
      previewItemSQL({ variables: { data: { itemId: item.id } } });
    }, [item.id]);

    useEffect(() => {
      setForceLoading(true);
      nextTick(200).then(() => {
        setForceUpdate((prev) => prev + 1);
        setForceLoading(false);
      });
    }, [item.layout]);

    const title = useMemo(() => {
      return item.displayName || item.detail.chartSchema?.title || '';
    }, [item.displayName, item.detail.chartSchema?.title]);

    const onHideLegend = () => {
      setIsHideLegend(!isHideLegend);
      setForceUpdate((prev) => prev + 1);
    };

    const onMoreClick = async (action: MORE_ACTION) => {
      if (action === MORE_ACTION.DELETE) {
        await onDelete(item.id);
      } else if (action === MORE_ACTION.REFRESH) {
        previewItemSQL({
          variables: { data: { itemId: item.id, refresh: isSupportCached } },
        });
      } else if (action === MORE_ACTION.HIDE_CATEGORY) {
        onHideLegend();
      }
    };

    const loading = forceLoading || previewItemSQLResult.loading;

    return (
      <div className="adm-pinned-item">
        <div className="adm-pinned-item-header">
          <div
            className="adm-pinned-item-title"
            title={title}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <PinnedItemTitle id={item.id} title={title} />
          </div>

          <div className="adm-pinned-actions">
            <DashboardItemDropdown
              onMoreClick={onMoreClick}
              isHideLegend={isHideLegend}
              isSupportCached={isSupportCached}
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
            <LoadingWrapper loading={loading} tip="Loading...">
              <Chart
                className="adm-pinned-item-chart"
                width="100%"
                height="100%"
                spec={detail.chartSchema}
                values={previewItem?.data}
                forceUpdate={forceUpdate}
                autoFilter
                hideActions
                hideTitle
                hideLegend={isHideLegend}
                isPinned
              />
            </LoadingWrapper>
          </div>
          {lastRefreshTime && (
            <div className="adm-pinned-content-info">
              Last refreshed: {getCompactTime(lastRefreshTime)}
            </div>
          )}
        </div>
      </div>
    );
  },
);
