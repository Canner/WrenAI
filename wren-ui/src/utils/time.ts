import dayJs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import relativeTime from 'dayjs/plugin/relativeTime';

dayJs.extend(utc);
dayJs.extend(relativeTime);

export const nextTick = (ms = 1) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const getRelativeTime = (time: string) => {
  return dayJs(time).utc().fromNow();
};

export const getAbsoluteTime = (time: string) => {
  return dayJs(time).utc().format('YYYY-MM-DD HH:mm:ss');
};

export const getFullNameDate = (time: string) => {
  return dayJs(time).utc().format('MMMM DD, YYYY');
};

export const getShortDate = (time: string) => {
  return dayJs(time).utc().format('MMM DD');
};
