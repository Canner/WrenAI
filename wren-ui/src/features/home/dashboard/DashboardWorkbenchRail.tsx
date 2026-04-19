import { Input } from 'antd';

import type { DashboardGridItem } from '@/components/pages/home/dashboardGrid';

import {
  DashboardDetailRow,
  DashboardDetailStack,
  DashboardPill,
  DashboardQuickActions,
  DashboardRail,
  DashboardRailCard,
  DashboardRailItem,
  DashboardRailList,
  DashboardRailMeta,
  DashboardRailTitle,
  WorkbenchActionButton,
  WorkbenchPrimaryActionButton,
} from './manageDashboardPageStyles';

export const DashboardWorkbenchRail = (props: {
  activeDashboardId: number | null;
  cardKeyword: string;
  dashboardKeyword: string;
  dashboards: Array<{
    id: number;
    name: string;
    cacheEnabled?: boolean | null;
    scheduleFrequency?: string | null;
  }>;
  filteredDashboardSummaryItems: Array<{
    id: number;
    title: string;
    meta: string;
  }>;
  isDashboardReadonly: boolean;
  onCardKeywordChange: (value: string) => void;
  onCreateDashboard: () => void;
  onDashboardKeywordChange: (value: string) => void;
  onDeleteSelectedItem: () => void;
  onFocusSelectedItem: () => void;
  onGoToSourceThread: () => void;
  onSelectDashboard: (dashboardId: number) => void;
  onSelectItem: (itemId: number) => void;
  selectedDashboardItem: DashboardGridItem | null;
}) => {
  const {
    activeDashboardId,
    cardKeyword,
    dashboardKeyword,
    dashboards,
    filteredDashboardSummaryItems,
    isDashboardReadonly,
    onCardKeywordChange,
    onCreateDashboard,
    onDashboardKeywordChange,
    onDeleteSelectedItem,
    onFocusSelectedItem,
    onGoToSourceThread,
    onSelectDashboard,
    onSelectItem,
    selectedDashboardItem,
  } = props;

  return (
    <DashboardRail>
      <DashboardRailCard>
        <div className="console-panel-title">看板</div>
        <Input.Search
          allowClear
          value={dashboardKeyword}
          onChange={(event) => onDashboardKeywordChange(event.target.value)}
          placeholder="搜索看板名称"
          style={{ marginTop: 12 }}
        />
        <DashboardQuickActions>
          <WorkbenchPrimaryActionButton
            type="primary"
            disabled={isDashboardReadonly}
            onClick={onCreateDashboard}
          >
            新建看板
          </WorkbenchPrimaryActionButton>
        </DashboardQuickActions>
        <DashboardRailList>
          {dashboards.length === 0 ? (
            <DashboardRailMeta>
              当前工作空间下还没有匹配的看板。
            </DashboardRailMeta>
          ) : (
            dashboards.map((dashboard) => (
              <DashboardRailItem
                key={dashboard.id}
                type="button"
                $active={activeDashboardId === dashboard.id}
                onClick={() => onSelectDashboard(dashboard.id)}
              >
                <DashboardRailTitle>{dashboard.name}</DashboardRailTitle>
                <DashboardRailMeta>
                  {dashboard.cacheEnabled ? '缓存调度已开启' : '实时模式'} ·{' '}
                  {dashboard.scheduleFrequency || '按需刷新'}
                </DashboardRailMeta>
              </DashboardRailItem>
            ))
          )}
        </DashboardRailList>
      </DashboardRailCard>

      <DashboardRailCard>
        <div className="console-panel-title">图表</div>
        <Input.Search
          allowClear
          value={cardKeyword}
          onChange={(event) => onCardKeywordChange(event.target.value)}
          placeholder="搜索图表名称或类型"
          style={{ marginTop: 12 }}
        />
        <DashboardRailList>
          {filteredDashboardSummaryItems.length === 0 ? (
            <DashboardRailMeta>当前看板还没有图表卡片。</DashboardRailMeta>
          ) : (
            filteredDashboardSummaryItems.map((item) => (
              <DashboardRailItem
                key={item.id}
                type="button"
                $active={selectedDashboardItem?.id === item.id}
                onClick={() => onSelectItem(item.id)}
              >
                <DashboardRailTitle>{item.title}</DashboardRailTitle>
                <DashboardRailMeta>{item.meta}</DashboardRailMeta>
              </DashboardRailItem>
            ))
          )}
        </DashboardRailList>
      </DashboardRailCard>

      <DashboardRailCard>
        <div className="console-panel-title">选中图表</div>
        {selectedDashboardItem ? (
          <DashboardDetailStack>
            <DashboardRailTitle>
              {selectedDashboardItem.displayName ||
                `图表卡片 ${selectedDashboardItem.id}`}
            </DashboardRailTitle>
            <DashboardDetailRow>
              <span>图表类型</span>
              <DashboardPill>{selectedDashboardItem.type}</DashboardPill>
            </DashboardDetailRow>
            <DashboardDetailRow>
              <span>布局尺寸</span>
              <span>
                {selectedDashboardItem.layout.w} ×{' '}
                {selectedDashboardItem.layout.h}
              </span>
            </DashboardDetailRow>
            <DashboardDetailRow>
              <span>SQL 状态</span>
              <span>
                {selectedDashboardItem.detail?.sql
                  ? '已生成 SQL'
                  : '待补充 SQL'}
              </span>
            </DashboardDetailRow>
            <DashboardDetailRow>
              <span>来源线程</span>
              <span>
                {selectedDashboardItem.detail?.sourceThreadId != null
                  ? `#${selectedDashboardItem.detail.sourceThreadId}`
                  : '未记录'}
              </span>
            </DashboardDetailRow>
            <DashboardDetailRow>
              <span>来源回答</span>
              <span>
                {selectedDashboardItem.detail?.sourceResponseId != null
                  ? `#${selectedDashboardItem.detail.sourceResponseId}`
                  : '未记录'}
              </span>
            </DashboardDetailRow>
            {selectedDashboardItem.detail?.sourceQuestion ? (
              <DashboardDetailRow>
                <span>来源问题</span>
                <span
                  title={selectedDashboardItem.detail.sourceQuestion}
                  style={{
                    flex: 1,
                    textAlign: 'right',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {selectedDashboardItem.detail.sourceQuestion}
                </span>
              </DashboardDetailRow>
            ) : null}
            <DashboardQuickActions>
              <WorkbenchActionButton onClick={onFocusSelectedItem}>
                定位到画布
              </WorkbenchActionButton>
              <WorkbenchActionButton onClick={onGoToSourceThread}>
                回到来源线程
              </WorkbenchActionButton>
              <WorkbenchActionButton
                danger
                disabled={isDashboardReadonly}
                onClick={onDeleteSelectedItem}
              >
                删除当前卡片
              </WorkbenchActionButton>
            </DashboardQuickActions>
          </DashboardDetailStack>
        ) : (
          <DashboardRailMeta>先从问答结果中固定图表到看板。</DashboardRailMeta>
        )}
      </DashboardRailCard>
    </DashboardRail>
  );
};
