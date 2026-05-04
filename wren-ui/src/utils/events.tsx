export const subscribe = (eventName: string, listener: any) => {
  document.addEventListener(eventName, listener);
};

export const unsubscribe = (eventName: string, listener: any) => {
  document.removeEventListener(eventName, listener);
};

export const dispatch = (eventName: string, detail?: any) => {
  const event = new CustomEvent(eventName, { detail });
  document.dispatchEvent(event);
};

export const EVENT_NAME = {
  GO_TO_FIRST_MODEL: 'goToFirstModel',
};
