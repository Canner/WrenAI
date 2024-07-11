import { omitBy, isUndefined } from 'lodash';

/**
 * @function
 * @description Remove undefined property value in an object
 */
export const compactObject = <T>(obj: T) => {
  return omitBy(obj, isUndefined) as T;
};

/**
 * @function
 * @description Retrieve json without error
 */
export const parseJson = (data) => {
  try {
    return JSON.parse(data);
  } catch (_e) {
    return data;
  }
};
