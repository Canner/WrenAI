import { ERROR_TEXTS } from '@/utils/error';
import type { ViewValidationResponse } from '@/utils/viewRest';

export const createViewNameValidator =
  (
    validateViewNameRequest: (name: string) => Promise<ViewValidationResponse>,
  ) =>
  async (_rule: any, value: string) => {
    if (!value) {
      return Promise.reject(ERROR_TEXTS.SAVE_AS_VIEW.NAME.REQUIRED);
    }

    try {
      const { valid, message } = await validateViewNameRequest(value);

      if (!valid) {
        return Promise.reject(message);
      }

      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error.message : '视图名称校验失败，请稍后重试',
      );
    }
  };
