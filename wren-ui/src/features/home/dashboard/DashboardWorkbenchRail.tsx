import {
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  StarOutlined,
} from '@ant-design/icons';
import {
  Descriptions,
  Divider,
  Dropdown,
  Empty,
  Menu,
  Tag,
  Tooltip,
  Typography,
} from 'antd';

import type { DashboardGridItem } from '@/components/pages/home/dashboardGrid';
import { resolveDashboardDisplayName } from '@/utils/dashboardRest';

import {
  DashboardDetailActions,
  DashboardDetailCard,
  DashboardDetailHeader,
  DashboardDetailHint,
  DashboardDetailMeta,
  DashboardDetailName,
  DashboardRail,
  DashboardRailCard,
  DashboardRailCreateButton,
  DashboardRailItem,
  DashboardRailItemBody,
  DashboardRailItemMenuButton,
  DashboardRailList,
  DashboardRailMeta,
  DashboardRailSection,
  DashboardRailSectionCount,
  DashboardRailSectionHeader,
  DashboardRailSectionTitle,
  DashboardRailTitle,
  WorkbenchActionButton,
} from './manageDashboardPageStyles';

export const DashboardWorkbenchRail = (props: {
  activeDashboardId: number | null;
  canShowCacheSettings: boolean;
  dashboards: Array<{
    id: number;
    isDefault?: boolean | null;
    name: string;
    cacheEnabled?: boolean | null;
    scheduleFrequency?: string | null;
  }>;
  dashboardMutationTargetId: number | null;
  filteredDashboardSummaryItems: Array<{
    id: number;
    title: string;
    meta: string;
  }>;
  hasDashboardSummaryItems: boolean;
  isDashboardReadonly: boolean;
  onCacheSettings: () => void;
  onCreateDashboard: () => void;
  onDeleteDashboard: (dashboardId: number) => void;
  onDeleteSelectedItem: () => void;
  onFocusSelectedItem: () => void;
  onGoToSourceThread: () => void;
  onRefreshDashboard: () => void;
  onRenameDashboard: (dashboardId: number) => void;
  onSelectDashboard: (dashboardId: number) => void;
  onSelectItem: (itemId: number) => void;
  onSetDefaultDashboard: (dashboardId: number) => void;
  selectedDashboardItem: DashboardGridItem | null;
}) => {
  const {
    activeDashboardId,
    canShowCacheSettings,
    dashboards,
    dashboardMutationTargetId,
    filteredDashboardSummaryItems,
    hasDashboardSummaryItems,
    isDashboardReadonly,
    onCacheSettings,
    onCreateDashboard,
    onDeleteDashboard,
    onDeleteSelectedItem,
    onFocusSelectedItem,
    onGoToSourceThread,
    onRefreshDashboard,
    onRenameDashboard,
    onSelectDashboard,
    onSelectItem,
    onSetDefaultDashboard,
    selectedDashboardItem,
  } = props;

  return (
    <DashboardRail>
      <DashboardRailCard bordered={false}>
        <DashboardRailSection>
          <DashboardRailSectionHeader>
            <DashboardRailSectionTitle>看板</DashboardRailSectionTitle>
            <DashboardRailSectionCount>
              {dashboards.length}
            </DashboardRailSectionCount>
          </DashboardRailSectionHeader>
          <DashboardRailList>
            {dashboards.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="没有匹配的看板"
              />
            ) : (
              dashboards.map((dashboard) => {
                const isMutating = dashboardMutationTargetId === dashboard.id;
                const isActiveDashboard = activeDashboardId === dashboard.id;
                const menu = (
                  <Menu onClick={({ domEvent }) => domEvent.stopPropagation()}>
                    {isActiveDashboard ? (
                      <Menu.Item
                        key="refresh"
                        icon={<ReloadOutlined />}
                        disabled={isDashboardReadonly || isMutating}
                        onClick={() => onRefreshDashboard()}
                      >
                        刷新看板
                      </Menu.Item>
                    ) : null}
                    {isActiveDashboard && canShowCacheSettings ? (
                      <Menu.Item
                        key="cache-settings"
                        icon={<ClockCircleOutlined />}
                        disabled={isDashboardReadonly || isMutating}
                        onClick={() => onCacheSettings()}
                      >
                        缓存与调度
                      </Menu.Item>
                    ) : null}
                    <Menu.Item
                      key="rename"
                      icon={<EditOutlined />}
                      disabled={isDashboardReadonly || isMutating}
                      onClick={() => onRenameDashboard(dashboard.id)}
                    >
                      重命名
                    </Menu.Item>
                    {!dashboard.isDefault ? (
                      <Menu.Item
                        key="default"
                        icon={<StarOutlined />}
                        disabled={isDashboardReadonly || isMutating}
                        onClick={() => onSetDefaultDashboard(dashboard.id)}
                      >
                        设为默认
                      </Menu.Item>
                    ) : null}
                    <Menu.Item
                      key="delete"
                      icon={<DeleteOutlined />}
                      danger
                      disabled={isDashboardReadonly || isMutating}
                      onClick={() => onDeleteDashboard(dashboard.id)}
                    >
                      删除看板
                    </Menu.Item>
                  </Menu>
                );

                return (
                  <DashboardRailItem
                    key={dashboard.id}
                    type="button"
                    $active={activeDashboardId === dashboard.id}
                    onClick={() => onSelectDashboard(dashboard.id)}
                  >
                    <DashboardRailItemBody>
                      <DashboardRailTitle>
                        <Typography.Text ellipsis style={{ marginBottom: 0 }}>
                          {resolveDashboardDisplayName(dashboard.name)}
                        </Typography.Text>
                        {dashboard.isDefault ? (
                          <Tag color="purple">默认</Tag>
                        ) : null}
                      </DashboardRailTitle>
                    </DashboardRailItemBody>
                    <Dropdown overlay={menu} trigger={['click']}>
                      <DashboardRailItemMenuButton
                        type="text"
                        loading={isMutating}
                        icon={<MoreOutlined />}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </Dropdown>
                  </DashboardRailItem>
                );
              })
            )}
          </DashboardRailList>
          <DashboardRailCreateButton
            block
            disabled={isDashboardReadonly}
            icon={<PlusOutlined />}
            onClick={onCreateDashboard}
          >
            新建看板
          </DashboardRailCreateButton>
        </DashboardRailSection>

        {hasDashboardSummaryItems ? (
          <>
            <Divider style={{ margin: '4px 0' }} />
            <DashboardRailSection>
              <DashboardRailSectionHeader>
                <DashboardRailSectionTitle>
                  已固定图表
                </DashboardRailSectionTitle>
                <DashboardRailSectionCount>
                  {filteredDashboardSummaryItems.length}
                </DashboardRailSectionCount>
              </DashboardRailSectionHeader>
              <DashboardRailList>
                {filteredDashboardSummaryItems.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="没有匹配的图表"
                  />
                ) : (
                  filteredDashboardSummaryItems.map((item) => (
                    <DashboardRailItem
                      key={item.id}
                      type="button"
                      $active={selectedDashboardItem?.id === item.id}
                      onClick={() => onSelectItem(item.id)}
                    >
                      <DashboardRailItemBody>
                        <DashboardRailTitle>
                          <Typography.Text ellipsis style={{ marginBottom: 0 }}>
                            {item.title}
                          </Typography.Text>
                        </DashboardRailTitle>
                        <DashboardRailMeta>{item.meta}</DashboardRailMeta>
                      </DashboardRailItemBody>
                    </DashboardRailItem>
                  ))
                )}
              </DashboardRailList>
            </DashboardRailSection>
          </>
        ) : null}

        {selectedDashboardItem ? (
          <>
            <Divider style={{ margin: '4px 0' }} />
            <DashboardDetailCard>
              <DashboardDetailHeader>
                <DashboardDetailName>
                  <DashboardRailSectionTitle>
                    当前图表
                  </DashboardRailSectionTitle>
                  <Typography.Text strong ellipsis>
                    {selectedDashboardItem.displayName ||
                      `图表卡片 ${selectedDashboardItem.id}`}
                  </Typography.Text>
                </DashboardDetailName>
                <Tag color="blue">{selectedDashboardItem.type}</Tag>
              </DashboardDetailHeader>
              <DashboardDetailMeta>
                <Tag>
                  {selectedDashboardItem.layout.w} ×{' '}
                  {selectedDashboardItem.layout.h}
                </Tag>
                {selectedDashboardItem.detail?.sourceThreadId != null ? (
                  <Tag>线程 #{selectedDashboardItem.detail.sourceThreadId}</Tag>
                ) : null}
                {selectedDashboardItem.detail?.sourceResponseId != null ? (
                  <Tag>
                    回答 #{selectedDashboardItem.detail.sourceResponseId}
                  </Tag>
                ) : null}
              </DashboardDetailMeta>
              <DashboardDetailHint>
                已固定到当前看板，可直接回到来源线程继续追问，或在画布中调整布局。
              </DashboardDetailHint>
              <Descriptions
                column={1}
                size="small"
                colon={false}
                style={{ marginTop: 10 }}
              >
                {selectedDashboardItem.detail?.sourceQuestion ? (
                  <Descriptions.Item label="来源问题">
                    <Tooltip
                      title={selectedDashboardItem.detail.sourceQuestion}
                    >
                      <Typography.Text ellipsis style={{ maxWidth: 180 }}>
                        {selectedDashboardItem.detail.sourceQuestion}
                      </Typography.Text>
                    </Tooltip>
                  </Descriptions.Item>
                ) : null}
              </Descriptions>
              <DashboardDetailActions>
                <WorkbenchActionButton block onClick={onFocusSelectedItem}>
                  定位到画布
                </WorkbenchActionButton>
                <WorkbenchActionButton block onClick={onGoToSourceThread}>
                  回到来源线程
                </WorkbenchActionButton>
                <WorkbenchActionButton
                  block
                  danger
                  disabled={isDashboardReadonly}
                  style={{ gridColumn: '1 / -1' }}
                  onClick={onDeleteSelectedItem}
                >
                  删除当前卡片
                </WorkbenchActionButton>
              </DashboardDetailActions>
            </DashboardDetailCard>
          </>
        ) : null}
      </DashboardRailCard>
    </DashboardRail>
  );
};
