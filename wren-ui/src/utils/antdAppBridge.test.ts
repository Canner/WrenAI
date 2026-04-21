import { Modal, message } from 'antd';

import {
  appMessage,
  appModal,
  clearAntdAppBridge,
  setAntdAppBridge,
} from './antdAppBridge';

jest.mock('antd', () => ({
  message: {
    open: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
    loading: jest.fn(),
    destroy: jest.fn(),
  },
  Modal: {
    confirm: jest.fn(),
    info: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    destroyAll: jest.fn(),
  },
  notification: {
    open: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
    destroy: jest.fn(),
  },
}));

const createBridgeMessageApi = () => ({
  open: jest.fn(),
  success: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
  info: jest.fn(),
  loading: jest.fn(),
  destroy: jest.fn(),
});

const createBridgeModalApi = () => ({
  confirm: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
});

describe('antdAppBridge', () => {
  beforeEach(() => {
    clearAntdAppBridge();
    jest.clearAllMocks();
  });

  it('falls back to antd static message api when no bridge is registered', () => {
    appMessage.error('加载失败');

    expect(message.error).toHaveBeenCalledWith('加载失败');
  });

  it('prefers the registered bridge message api when available', () => {
    const bridgeMessageApi = createBridgeMessageApi();

    setAntdAppBridge({
      message: bridgeMessageApi,
    });

    appMessage.success('保存成功');

    expect(bridgeMessageApi.success).toHaveBeenCalledWith('保存成功');
    expect(message.success).not.toHaveBeenCalled();
  });

  it('prefers the registered bridge modal api for confirm dialogs', () => {
    const bridgeModalApi = createBridgeModalApi();
    const config = {
      title: '确认删除',
    };

    setAntdAppBridge({
      modal: bridgeModalApi,
    });

    appModal.confirm(config);

    expect(bridgeModalApi.confirm).toHaveBeenCalledWith(config);
    expect(Modal.confirm).not.toHaveBeenCalled();
  });
});
