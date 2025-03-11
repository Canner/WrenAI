export const createSQLPairQuestionValidator =
  (errorObj: any) => async (_rule: any, value: string) => {
    if (!value) {
      return Promise.reject(errorObj.REQUIRED);
    }

    if (value.trim() === '') {
      return Promise.reject(errorObj.REQUIRED);
    }

    if (value.length > 300) {
      return Promise.reject(errorObj.MAX_LENGTH);
    }

    return Promise.resolve();
  };
