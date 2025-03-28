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

export const attachLoading = (
  asyncRequest: (...args: any[]) => Promise<any>,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
) => {
  return async (...args) => {
    setLoading(true);
    try {
      await asyncRequest(...args);
    } finally {
      setLoading(false);
    }
  };
};
