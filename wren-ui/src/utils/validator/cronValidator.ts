import { ERROR_TEXTS } from '@/utils/error';

export const isValidCron = (cron: string) => {
  return cron?.trim().split(' ').length === 5;
};

export const cronValidator = (_, value: string) => {
  if (!value) return Promise.reject(ERROR_TEXTS.CRON.REQUIRED);
  if (!isValidCron(value)) {
    return Promise.reject(ERROR_TEXTS.CRON.INVALID);
  }
  return Promise.resolve();
};
