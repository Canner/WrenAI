import { resolveNetworkErrorMessage } from './errorHandler';

describe('resolveNetworkErrorMessage', () => {
  const setNavigatorOnline = (online: boolean) => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: online },
    });
  };

  beforeEach(() => {
    setNavigatorOnline(true);
  });

  it('returns an offline message for fetch connectivity failures', () => {
    expect(
      resolveNetworkErrorMessage({
        name: 'TypeError',
        message: 'Failed to fetch',
      } as any),
    ).toBe('网络不可用，请检查连接后重试。');
  });

  it('returns an auth message for unauthorized responses', () => {
    expect(
      resolveNetworkErrorMessage({
        name: 'ServerError',
        message: 'Response not successful: Received status code 401',
        statusCode: 401,
      } as any),
    ).toBe('登录已过期或无访问权限，请重新登录后重试。');
  });

  it('maps runtime scope bootstrap failures to a targeted message', () => {
    expect(
      resolveNetworkErrorMessage({
        name: 'ServerError',
        message: 'Response not successful: Received status code 500',
        statusCode: 500,
        result: {
          errors: [
            {
              message:
                'Context creation failed: No deployment found for the requested runtime scope',
            },
          ],
        },
      } as any),
    ).toBe('当前工作空间上下文不可用，请刷新或重新选择知识库后重试。');
  });

  it('prefers structured backend error codes for deployment-specific runtime failures', () => {
    expect(
      resolveNetworkErrorMessage({
        name: 'ServerError',
        message: 'Response not successful: Received status code 500',
        statusCode: 500,
        result: {
          errors: [
            {
              message:
                'Current knowledge base runtime is unavailable. Refresh or reselect a knowledge base and try again.',
              extensions: {
                code: 'NO_DEPLOYMENT_FOUND',
              },
            },
          ],
        },
      } as any),
    ).toBe('当前知识库运行时不可用，请刷新或重新选择知识库后重试。');
  });

  it('falls back to a generic service message for server errors', () => {
    expect(
      resolveNetworkErrorMessage({
        name: 'ServerError',
        message: 'Response not successful: Received status code 503',
        statusCode: 503,
        bodyText: JSON.stringify({
          errors: [{ message: 'Context creation failed: internal boom' }],
        }),
      } as any),
    ).toBe('服务暂时不可用，请稍后重试。');
  });

  it('ignores aborted network requests', () => {
    expect(
      resolveNetworkErrorMessage(
        new DOMException('signal is aborted without reason', 'AbortError') as any,
      ),
    ).toBeNull();

    expect(
      resolveNetworkErrorMessage({
        name: 'AbortError',
        message: 'signal is aborted without reason',
      } as any),
    ).toBeNull();
  });
});
