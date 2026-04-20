describe('toDockerHost', () => {
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
    process,
    'platform',
  );

  afterEach(() => {
    jest.resetModules();
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor);
    }
  });

  it('rewrites loopback aliases on darwin', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin',
    });

    const { toDockerHost } = await import('../docker');

    expect(toDockerHost('localhost')).toBe('docker.for.mac.localhost');
    expect(toDockerHost('127.0.0.1')).toBe('docker.for.mac.localhost');
    expect(toDockerHost('127.1')).toBe('docker.for.mac.localhost');
    expect(toDockerHost('::1')).toBe('docker.for.mac.localhost');
  });

  it('keeps non-loopback hosts unchanged', async () => {
    const { toDockerHost } = await import('../docker');

    expect(toDockerHost('host.docker.internal')).toBe('host.docker.internal');
    expect(toDockerHost('192.168.1.10')).toBe('192.168.1.10');
    expect(toDockerHost('wrenai-local-tidb-demo')).toBe(
      'wrenai-local-tidb-demo',
    );
  });
});
