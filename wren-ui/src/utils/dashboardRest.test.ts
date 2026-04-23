import {
  clearDashboardRestCache,
  loadDashboardListPayload,
  peekDashboardListPayload,
  primeDashboardListPayload,
  resolveDashboardDisplayName,
} from './dashboardRest';

const createJsonResponse = (payload: unknown, ok = true) =>
  ({
    ok,
    json: async () => payload,
  }) as Response;

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe('resolveDashboardDisplayName', () => {
  afterEach(() => {
    clearDashboardRestCache();
  });

  it('normalizes legacy default dashboard storage name', () => {
    expect(resolveDashboardDisplayName('Dashboard')).toBe('默认看板');
  });

  it('falls back to default dashboard when the stored name is empty', () => {
    expect(resolveDashboardDisplayName('')).toBe('默认看板');
    expect(resolveDashboardDisplayName(null)).toBe('默认看板');
  });

  it('keeps custom dashboard names unchanged', () => {
    expect(resolveDashboardDisplayName('经营总览')).toBe('经营总览');
  });

  it('does not let stale in-flight list requests repopulate cache after cache clear', async () => {
    const requestUrl = '/api/v1/dashboards?workspaceId=workspace-1';
    const staleRequest = createDeferred<Response>();

    const staleLoadPromise = loadDashboardListPayload({
      requestUrl,
      useCache: false,
      fetcher: jest.fn().mockReturnValue(staleRequest.promise) as any,
    });

    clearDashboardRestCache();
    staleRequest.resolve(createJsonResponse([]));
    await expect(staleLoadPromise).resolves.toEqual([]);
    expect(peekDashboardListPayload({ requestUrl })).toBeNull();

    const freshPayload = [{ id: 9, name: '经营总览', cacheEnabled: true }];
    await expect(
      loadDashboardListPayload({
        requestUrl,
        useCache: false,
        fetcher: jest
          .fn()
          .mockResolvedValue(createJsonResponse(freshPayload)) as any,
      }),
    ).resolves.toEqual(freshPayload);
    expect(peekDashboardListPayload({ requestUrl })).toEqual(freshPayload);
  });

  it('primes dashboard list cache with the latest payload', () => {
    const requestUrl = '/api/v1/dashboards?workspaceId=workspace-1';
    const payload = [{ id: 3, name: '默认看板', cacheEnabled: true }];

    primeDashboardListPayload({ requestUrl, payload: payload as any });

    expect(peekDashboardListPayload({ requestUrl })).toEqual(payload);
  });
});
