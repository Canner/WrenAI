import { NODE_TYPE } from '../enum';

export const modelFieldSelectorValidator = (errorTexts) => (_, value) => {
  if (!value) return Promise.reject(new Error(errorTexts.REQUIRED));

  const lastValue = value[value.length - 1];
  if (lastValue.nodeType !== NODE_TYPE.FIELD) {
    return Promise.reject(new Error(errorTexts.REQUIRED));
  }

  return Promise.resolve();
};
