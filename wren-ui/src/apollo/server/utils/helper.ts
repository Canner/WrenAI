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

export const convertColumnType = (parent: { type: string }) => {
  return parent.type.includes('STRUCT') ? 'RECORD' : parent.type;
};
