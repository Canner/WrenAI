export const toDockerHost = (host: string) => {
  // if host is localhost or 127.0.0.1, rewrite it to docker.for.{platform}.localhost
  if (host === 'localhost' || host === '127.0.0.1') {
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
