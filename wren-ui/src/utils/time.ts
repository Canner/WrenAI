export const nextTick = (ms = 1) =>
  new Promise((resolve) => setTimeout(resolve, ms));
