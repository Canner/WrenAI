import { invert } from 'lodash';

/**
 * @function
 * @description Retrieve json without error
 */
export const parseJson = (data) => {
  try {
    return JSON.parse(data);
  } catch (_e) {
    return false;
  }
};

export const reverseEnum = <E extends Record<keyof E, string | number>>(
  enumObject: E,
) =>
  invert(enumObject) as {
    [V in E[keyof E]]: Extract<
      { [K in keyof E]: [K, E[K]] }[keyof E],
      [any, V]
    >[0];
  };
