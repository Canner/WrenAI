import { message } from 'antd';
import { handleOperationError } from './errorHandlerOperationHandlers';

jest.mock('antd', () => ({
  message: {
    error: jest.fn(),
  },
}));

describe('handleOperationError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits the mapped fallback copy for known operations', () => {
    handleOperationError('CreateThread', {});

    expect(message.error).toHaveBeenCalledWith('创建对话失败，请稍后重试。');
  });

  it('injects the detail message for update connection failures', () => {
    handleOperationError('UpdateConnection', {
      message: 'The connection is not found.',
    });

    expect(message.error).toHaveBeenCalledWith(
      'Failed to update - The connection is not found..',
    );
  });
});
