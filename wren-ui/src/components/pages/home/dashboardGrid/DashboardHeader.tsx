import { Button, Tooltip } from 'antd';
import styled from 'styled-components';
import { MoreIcon } from '@/utils/icons';
import { MORE_ACTION } from '@/utils/enum';
import { getCompactTime } from '@/utils/time';
import { DashboardDropdown } from '@/components/diagram/CustomDropdown';
import {
  Schedule,
  getScheduleText,
} from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';

interface Props {
  nextScheduleTime?: string;
  schedule?: Schedule;
  onCacheSettings?: () => void;
  onRefreshAll?: () => void;
}

const StyledHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 49px;
  padding: 8px 16px;
  background-color: white;
  border-bottom: 1px solid var(--gray-4);
`;

export default function DashboardHeader(props: Props) {
  const { nextScheduleTime, schedule, onCacheSettings, onRefreshAll } = props;

  const scheduleTime = getScheduleText(schedule);

  const onMoreClick = async (action: MORE_ACTION) => {
    if (action === MORE_ACTION.CACHE_SETTINGS) {
      onCacheSettings?.();
    } else if (action === MORE_ACTION.REFRESH) {
      onRefreshAll?.();
    }
  };

  return (
    <StyledHeader>
      <div />
      <div>
        {schedule && (
          <div>
            <div className="d-flex align-center gray-6 gx-2">
              {nextScheduleTime ? (
                <Tooltip
                  placement="bottom"
                  title={`Next schedule: ${getCompactTime(nextScheduleTime)}`}
                >
                  <span className="cursor-pointer">{scheduleTime}</span>
                </Tooltip>
              ) : (
                scheduleTime
              )}
              <DashboardDropdown onMoreClick={onMoreClick}>
                <Button type="text" icon={<MoreIcon />}></Button>
              </DashboardDropdown>
            </div>
          </div>
        )}
      </div>
    </StyledHeader>
  );
}
