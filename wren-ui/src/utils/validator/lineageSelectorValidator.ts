import { NODE_TYPE } from '@/utils/enum';

export const lineageSelectorValidator = (errorTexts) => (_, value) => {
  if (!value) return Promise.reject(new Error(errorTexts.REQUIRED));

  const lastValue = value[value.length - 1];
  if (
    ![NODE_TYPE.FIELD, NODE_TYPE.CALCULATED_FIELD].includes(lastValue.nodeType)
  ) {
    return Promise.reject(new Error(errorTexts.REQUIRED));
  }

  return Promise.resolve();
};
