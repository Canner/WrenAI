import {
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  StarOutlined,
} from '@ant-design/icons';
import type { KeyboardEvent } from 'react';
import {
  Divider,
  Dropdown,
  Empty,
  Tag,
  Typography,
  type MenuProps,
} from 'antd';

import type { DashboardGridItem } from '@/components/pages/home/dashboardGrid';
import { resolveDashboardDisplayName } from '@/utils/dashboardRest';

import {
  DashboardRail,
  DashboardRailCard,
  DashboardRailCreateButton,
  DashboardRailInlineMeta,
  DashboardRailItem,
  DashboardRailItemBody,
  DashboardRailItemMenuButton,
  DashboardRailItemRow,
  DashboardRailList,
  DashboardRailSection,
  DashboardRailSectionCount,
  DashboardRailSectionHeader,
  DashboardRailSectionTitle,
  DashboardRailTitle,
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
  onCacheSettings: (dashboardId?: number) => void;
  onCreateDashboard: () => void;
  onDeleteDashboard: (dashboardId: number) => void;
  onRefreshDashboard: (dashboardId?: number) => void;
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
    onRefreshDashboard,
    onRenameDashboard,
    onSelectDashboard,
    onSelectItem,
    onSetDefaultDashboard,
    selectedDashboardItem,
  } = props;

  const handleRailItemKeyDown =
    (onActivate: () => void) => (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      onActivate();
    };

  return (
    <DashboardRail>
      <DashboardRailCard variant="borderless">
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
                const menuItems: NonNullable<MenuProps['items']> = [
                  {
                    key: 'refresh',
                    icon: <ReloadOutlined />,
                    label: '刷新看板',
                    disabled: isDashboardReadonly || isMutating,
                    onClick: () => onRefreshDashboard(dashboard.id),
                  },
                  ...(canShowCacheSettings
                    ? [
                        {
                          key: 'cache-settings',
                          icon: <ClockCircleOutlined />,
                          label: '缓存与调度',
                          disabled: isDashboardReadonly || isMutating,
                          onClick: () => onCacheSettings(dashboard.id),
                        },
                      ]
                    : []),
                  {
                    key: 'rename',
                    icon: <EditOutlined />,
                    label: '重命名',
                    disabled: isDashboardReadonly || isMutating,
                    onClick: () => onRenameDashboard(dashboard.id),
                  },
                  ...(!dashboard.isDefault
                    ? [
                        {
                          key: 'default',
                          icon: <StarOutlined />,
                          label: '设为默认',
                          disabled: isDashboardReadonly || isMutating,
                          onClick: () => onSetDefaultDashboard(dashboard.id),
                        },
                      ]
                    : []),
                  {
                    key: 'delete',
                    icon: <DeleteOutlined />,
                    label: '删除看板',
                    danger: true,
                    disabled: isDashboardReadonly || isMutating,
                    onClick: () => onDeleteDashboard(dashboard.id),
                  },
                ];

                return (
                  <DashboardRailItem
                    key={dashboard.id}
                    $active={isActiveDashboard}
                    aria-pressed={isActiveDashboard}
                    onClick={() => onSelectDashboard(dashboard.id)}
                    onKeyDown={handleRailItemKeyDown(() =>
                      onSelectDashboard(dashboard.id),
                    )}
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
                    <Dropdown
                      menu={{
                        items: menuItems,
                        onClick: ({ domEvent }) => domEvent.stopPropagation(),
                      }}
                      placement="bottomRight"
                      trigger={['click']}
                    >
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
                      $active={selectedDashboardItem?.id === item.id}
                      aria-pressed={selectedDashboardItem?.id === item.id}
                      onClick={() => onSelectItem(item.id)}
                      onKeyDown={handleRailItemKeyDown(() =>
                        onSelectItem(item.id),
                      )}
                    >
                      <DashboardRailItemBody>
                        <DashboardRailItemRow>
                          <DashboardRailTitle>
                            <Typography.Text
                              ellipsis
                              style={{ marginBottom: 0 }}
                            >
                              {item.title}
                            </Typography.Text>
                          </DashboardRailTitle>
                          <DashboardRailInlineMeta>
                            {item.meta}
                          </DashboardRailInlineMeta>
                        </DashboardRailItemRow>
                      </DashboardRailItemBody>
                    </DashboardRailItem>
                  ))
                )}
              </DashboardRailList>
            </DashboardRailSection>
          </>
        ) : null}
      </DashboardRailCard>
    </DashboardRail>
  );
};
