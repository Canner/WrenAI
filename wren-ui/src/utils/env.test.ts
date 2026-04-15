import { clearUserConfigCache, getUserConfig, UserConfig } from './env';

const encodedTelemetryKey = Buffer.from('telemetry-key').toString('base64');

describe('getUserConfig', () => {
  beforeEach(() => {
    clearUserConfigCache();
    jest.clearAllMocks();
  });

  it('deduplicates in-flight /api/config requests and caches the resolved config', async () => {
    const payload = {
      isTelemetryEnabled: true,
      telemetryKey: encodedTelemetryKey,
      telemetryHost: 'https://telemetry.example.com',
      userUUID: 'user-1',
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response);

    const [first, second] = await Promise.all([
      getUserConfig(),
      getUserConfig(),
    ]);

    expect(first).toEqual<UserConfig>({
      isTelemetryEnabled: true,
      telemetryKey: 'telemetry-key',
      telemetryHost: 'https://telemetry.example.com',
      userUUID: 'user-1',
    });
    expect(second).toEqual(first);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/api/config');

    const cached = await getUserConfig();

    expect(cached).toEqual(first);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns the default config when /api/config fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    await expect(getUserConfig()).resolves.toEqual<UserConfig>({
      isTelemetryEnabled: false,
      telemetryKey: '',
      telemetryHost: '',
      userUUID: '',
    });
  });
});
