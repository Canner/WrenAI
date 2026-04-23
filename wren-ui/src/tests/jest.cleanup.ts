type MaybeComponents = {
  askingService?: {
    stopBackgroundTrackers?: () => void;
  };
  askingTaskTracker?: {
    stopPolling?: () => void;
  };
  dashboardCacheBackgroundTracker?: {
    stop?: () => void;
  };
  scheduleWorker?: {
    stop?: () => void;
  };
  telemetry?: {
    stop?: () => void;
  };
  knex?: {
    destroy?: () => Promise<void>;
  };
};

const COMPONENTS_SINGLETON_KEY = '__wrenComponents__';
const COMPONENTS_VERSION_KEY = '__wrenComponentsVersion__';

afterAll(async () => {
  const globalStore = globalThis as typeof globalThis & Record<string, unknown>;
  const components = globalStore[COMPONENTS_SINGLETON_KEY] as
    | MaybeComponents
    | undefined;

  if (!components) {
    return;
  }

  components.askingService?.stopBackgroundTrackers?.();
  components.askingTaskTracker?.stopPolling?.();
  components.dashboardCacheBackgroundTracker?.stop?.();
  components.scheduleWorker?.stop?.();
  components.telemetry?.stop?.();

  try {
    await components.knex?.destroy?.();
  } finally {
    delete globalStore[COMPONENTS_SINGLETON_KEY];
    delete globalStore[COMPONENTS_VERSION_KEY];
  }
});
