import { CronExpressionParser } from 'cron-parser';
import { ERROR_TEXTS } from '@/utils/error';

export const isValidCronLength = (cron: string) => {
  return cron?.trim().split(' ').length === 5;
};

export const cronValidator = (_, value: string) => {
  if (!value) return Promise.reject(ERROR_TEXTS.CRON.REQUIRED);
  if (!isValidCronLength(value)) {
    return Promise.reject(ERROR_TEXTS.CRON.INVALID);
  }
  try {
    CronExpressionParser.parse(value, { tz: 'UTC' });
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error.message);
  }
};
