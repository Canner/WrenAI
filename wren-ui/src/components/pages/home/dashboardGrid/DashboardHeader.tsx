import { Button, Tooltip } from 'antd';
import styled from 'styled-components';
import { MoreIcon } from '@/utils/icons';
import { MORE_ACTION } from '@/utils/enum';
import { getCompactTime } from '@/utils/time';
import { DashboardDropdown } from '@/components/diagram/CustomDropdown';
import { getScheduleText } from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';
import type { Schedule } from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';

interface Props {
  isSupportCached: boolean;
  readOnly?: boolean;
  nextScheduleTime?: string;
  schedule?: Schedule;
  onCacheSettings?: () => void;
  onRefreshAll?: () => void;
}

const StyledHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 46px;
  padding: 8px 14px;
  background: linear-gradient(180deg, #fcfcff 0%, #f7f8fe 100%);
  border-bottom: 1px solid var(--nova-outline-soft);
`;

const HeaderMeta = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--nova-text-secondary);
  font-size: 12px;
  line-height: 1.4;

  .cursor-pointer {
    color: var(--nova-text-secondary);
  }
`;

const HeaderHint = styled.span`
  color: var(--nova-text-secondary);
  font-size: 12px;
  line-height: 1.4;
`;

export default function DashboardHeader(props: Props) {
  const {
    isSupportCached,
    readOnly = false,
    nextScheduleTime,
    schedule,
    onCacheSettings,
    onRefreshAll,
  } = props;

  const scheduleTime = schedule ? getScheduleText(schedule) : '';

  const onMoreClick = (action: MORE_ACTION | { type: MORE_ACTION }) => {
    const actionType =
      typeof action === 'object' && action !== null ? action.type : action;
    if (actionType === MORE_ACTION.CACHE_SETTINGS) {
      onCacheSettings?.();
    } else if (actionType === MORE_ACTION.REFRESH) {
      onRefreshAll?.();
    }
  };

  return (
    <StyledHeader>
      <HeaderHint>拖拽卡片可直接调整布局</HeaderHint>
      <div>
        {schedule && (
          <HeaderMeta>
            {isSupportCached && (
              <>
                {nextScheduleTime ? (
                  <Tooltip
                    placement="bottom"
                    title={
                      <>
                        <div>
                          <span className="gray-6">下次刷新：</span>{' '}
                          {getCompactTime(nextScheduleTime)}
                        </div>
                        {schedule.cron && (
                          <div>
                            <span className="gray-6">Cron 表达式：</span>{' '}
                            {schedule.cron}
                          </div>
                        )}
                      </>
                    }
                  >
                    <span className="cursor-pointer">{scheduleTime}</span>
                  </Tooltip>
                ) : (
                  scheduleTime
                )}
              </>
            )}
            <DashboardDropdown
              onMoreClick={onMoreClick}
              isSupportCached={isSupportCached}
              disableCacheSettings={readOnly}
              disableRefresh={readOnly}
            >
              <Button type="text" icon={<MoreIcon className="gray-8" />} />
            </DashboardDropdown>
          </HeaderMeta>
        )}
      </div>
    </StyledHeader>
  );
}
