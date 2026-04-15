import { omitBy, isUndefined } from 'lodash';
import type { Dispatch, SetStateAction } from 'react';

/**
 * @function
 * @description Remove undefined property value in an object
 */
export const compactObject = <T extends object>(obj: T): T =>
  omitBy(obj as Record<string, unknown>, isUndefined) as T;

/**
 * @function
 * @description Retrieve json without error
 */
export const parseJson = <T = unknown>(data: string): T | string => {
  try {
    return JSON.parse(data) as T;
  } catch (_e) {
    return data;
  }
};

export const attachLoading = <TArgs extends unknown[], TResult>(
  asyncRequest: (...args: TArgs) => Promise<TResult>,
  setLoading: Dispatch<SetStateAction<boolean>>,
) => {
  return async (...args: TArgs): Promise<TResult> => {
    setLoading(true);
    try {
      return await asyncRequest(...args);
    } finally {
      setLoading(false);
    }
  };
};
