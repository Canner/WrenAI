import { Modal, message, notification } from 'antd';

type MessageFacade = Pick<
  typeof message,
  'open' | 'success' | 'error' | 'warning' | 'info' | 'loading' | 'destroy'
>;
type ModalHookFacade = Pick<
  typeof Modal,
  'confirm' | 'info' | 'success' | 'warning' | 'error'
>;
type ModalFacade = ModalHookFacade & Pick<typeof Modal, 'destroyAll'>;
type NotificationFacade = Pick<
  typeof notification,
  'open' | 'success' | 'error' | 'warning' | 'info' | 'destroy'
>;

type AntdAppBridgeApis = {
  message?: MessageFacade;
  modal?: ModalHookFacade;
  notification?: NotificationFacade;
};

let bridgeApis: AntdAppBridgeApis = {};

export const setAntdAppBridge = (nextApis: AntdAppBridgeApis) => {
  bridgeApis = nextApis;
};

export const clearAntdAppBridge = () => {
  bridgeApis = {};
};

const getMessageApi = (): MessageFacade => bridgeApis.message ?? message;
const getModalApi = (): ModalHookFacade => bridgeApis.modal ?? Modal;
const getNotificationApi = (): NotificationFacade =>
  bridgeApis.notification ?? notification;

export const appMessage: MessageFacade = {
  open: (...args) => getMessageApi().open(...args),
  success: (...args) => getMessageApi().success(...args),
  error: (...args) => getMessageApi().error(...args),
  warning: (...args) => getMessageApi().warning(...args),
  info: (...args) => getMessageApi().info(...args),
  loading: (...args) => getMessageApi().loading(...args),
  destroy: (...args) => getMessageApi().destroy(...args),
};

export const appModal: ModalFacade = {
  confirm: (...args) => getModalApi().confirm(...args),
  info: (...args) => getModalApi().info(...args),
  success: (...args) => getModalApi().success(...args),
  warning: (...args) => getModalApi().warning(...args),
  error: (...args) => getModalApi().error(...args),
  destroyAll: (...args) => Modal.destroyAll(...args),
};

export const appNotification: NotificationFacade = {
  open: (...args) => getNotificationApi().open(...args),
  success: (...args) => getNotificationApi().success(...args),
  error: (...args) => getNotificationApi().error(...args),
  warning: (...args) => getNotificationApi().warning(...args),
  info: (...args) => getNotificationApi().info(...args),
  destroy: (...args) => getNotificationApi().destroy(...args),
};
