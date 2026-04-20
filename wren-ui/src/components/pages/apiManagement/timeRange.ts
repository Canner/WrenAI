import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

export type ApiHistoryDateRange = [Dayjs, Dayjs] | null;

export const buildApiHistoryDateFilter = (dateRange: ApiHistoryDateRange) => {
  if (!dateRange?.[0] || !dateRange?.[1]) {
    return {};
  }

  return {
    startDate: dateRange[0].clone().startOf('day').toISOString(),
    endDate: dateRange[1].clone().endOf('day').toISOString(),
  };
};

export const hasApiHistoryDateRange = (dateRange: ApiHistoryDateRange) =>
  Boolean(dateRange?.[0] && dateRange?.[1]);

export const getApiHistoryDateRangePresets = (now = dayjs()) => ({
  '最近 24 小时': [now.clone().subtract(24, 'hour'), now.clone()],
  '最近 7 天': [
    now.clone().subtract(6, 'day').startOf('day'),
    now.clone().endOf('day'),
  ],
  '最近 30 天': [
    now.clone().subtract(29, 'day').startOf('day'),
    now.clone().endOf('day'),
  ],
});
