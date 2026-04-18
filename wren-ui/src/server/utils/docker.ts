export const toDockerHost = (host: string) => {
  // Loopback aliases are only reachable from the host process; dockerized services
  // need the host gateway instead.
  const isLoopbackHost =
    host === 'localhost' ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1' ||
    /^127(?:\.\d{1,3}){0,3}$/.test(host);

  if (isLoopbackHost) {
    const platform = process.platform;
    switch (platform) {
      case 'darwin':
        return 'docker.for.mac.localhost';
      case 'linux':
        return 'docker.for.linux.localhost';
      default:
        // windows and others...
        return 'host.docker.internal';
    }
  }
  return host;
};
