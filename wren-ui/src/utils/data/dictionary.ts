import { CACHED_PERIOD, JOIN_TYPE } from '@/utils/enum';

export const getJoinTypeText = (type) =>
  ({
    [JOIN_TYPE.MANY_TO_ONE]: 'Many-to-one',
    [JOIN_TYPE.ONE_TO_MANY]: 'One-to-many',
    [JOIN_TYPE.ONE_TO_ONE]: 'One-to-one',
  }[type] || 'Unknown');

export const getCachePeriodText = (period) =>
  ({
    [CACHED_PERIOD.DAY]: 'day(s)',
    [CACHED_PERIOD.HOUR]: 'hour(s)',
    [CACHED_PERIOD.MINUTE]: 'minute(s)',
    [CACHED_PERIOD.SECOND]: 'second(s)',
  }[period] || 'Unknown');
