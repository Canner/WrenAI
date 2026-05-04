import { ERROR_TEXTS } from '@/utils/error';

export const createViewNameValidator =
  (validateViewMutation: any) => async (_rule: any, value: string) => {
    if (!value) {
      return Promise.reject(ERROR_TEXTS.SAVE_AS_VIEW.NAME.REQUIRED);
    }

    const validateViewResult = await validateViewMutation({
      variables: { data: { name: value } },
    });

    const { valid, message } = validateViewResult?.data?.validateView;

    if (!valid) {
      return Promise.reject(message);
    }

    return Promise.resolve();
  };
