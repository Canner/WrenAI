/**
 * @function
 * @description Retrieve json without error
 */
export const safeParseJson = (data) => {
  try {
    return JSON.parse(data);
  } catch (_e) {
    return false;
  }
};

export const safeStringify = (data) => {
  if (typeof data === 'string') {
    return data;
  }
  try {
    return JSON.stringify(data);
  } catch (_e) {
    return data;
  }
};

export const convertColumnType = (parent: { type: string }) => {
  return parent.type.includes('STRUCT') ? 'RECORD' : parent.type;
};
