type VersionedSingletonOptions<T> = {
  factory: () => T;
  singletonKey: string;
  version: number;
  versionKey: string;
};

export const getVersionedGlobalSingleton = <T>({
  factory,
  singletonKey,
  version,
  versionKey,
}: VersionedSingletonOptions<T>) => {
  const globalStore = globalThis as typeof globalThis & Record<string, unknown>;
  const cachedSingleton = globalStore[singletonKey] as T | undefined;
  const cachedVersion = globalStore[versionKey] as number | undefined;

  if (cachedSingleton && cachedVersion === version) {
    return cachedSingleton;
  }

  const instance = factory();

  if (process.env.NODE_ENV !== 'production') {
    globalStore[singletonKey] = instance;
    globalStore[versionKey] = version;
  }

  return instance;
};
