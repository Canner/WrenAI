import moment, { Moment } from 'moment';

export type ApiHistoryDateRange = [Moment, Moment] | null;

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

export const getApiHistoryDateRangePresets = (now = moment()) => ({
  'Last 24 hours': [now.clone().subtract(24, 'hour'), now.clone()],
  'Last 7 days': [
    now.clone().subtract(6, 'day').startOf('day'),
    now.clone().endOf('day'),
  ],
  'Last 30 days': [
    now.clone().subtract(29, 'day').startOf('day'),
    now.clone().endOf('day'),
  ],
});
