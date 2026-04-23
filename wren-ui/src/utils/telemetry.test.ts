import posthog from 'posthog-js';
import {
  captureUserTelemetryEvent,
  resetTelemetryStateForTests,
  trackUserTelemetry,
} from './telemetry';

jest.mock('posthog-js', () => ({
  __esModule: true,
  default: {
    init: jest.fn(),
    identify: jest.fn(),
    capture: jest.fn(),
  },
}));

jest.mock('@/utils/env', () => ({
  __esModule: true,
  default: {
    isDevelopment: false,
  },
}));

const createRouterEvents = () =>
  ({
    on: jest.fn(),
    off: jest.fn(),
  }) as any;

describe('trackUserTelemetry', () => {
  beforeEach(() => {
    resetTelemetryStateForTests();
    jest.clearAllMocks();
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('initializes posthog once and always binds route listeners', () => {
    const routerEvents = createRouterEvents();
    const config = {
      isTelemetryEnabled: true,
      telemetryKey: 'telemetry-key',
      telemetryHost: 'https://telemetry.example.com',
      userUUID: 'user-1',
    };

    const cleanupFirst = trackUserTelemetry(routerEvents, config);
    const cleanupSecond = trackUserTelemetry(routerEvents, config);

    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.identify).toHaveBeenCalledTimes(1);
    expect(routerEvents.on).toHaveBeenCalledTimes(2);
    expect(routerEvents.on).toHaveBeenNthCalledWith(
      1,
      'routeChangeComplete',
      expect.any(Function),
    );

    cleanupFirst();
    cleanupSecond();

    expect(routerEvents.off).toHaveBeenCalledTimes(2);
    expect(routerEvents.off).toHaveBeenNthCalledWith(
      1,
      'routeChangeComplete',
      expect.any(Function),
    );
  });

  it('captures pageview on route change callback', () => {
    const routerEvents = createRouterEvents();
    const config = {
      isTelemetryEnabled: true,
      telemetryKey: 'telemetry-key',
      telemetryHost: 'https://telemetry.example.com',
      userUUID: '',
    };

    trackUserTelemetry(routerEvents, config);

    const routeChangeHandler = routerEvents.on.mock.calls[0][1];
    routeChangeHandler('/home');

    expect(posthog.capture).toHaveBeenCalledWith('$pageview');
  });

  it('skips telemetry setup when disabled', () => {
    const routerEvents = createRouterEvents();
    const config = {
      isTelemetryEnabled: false,
      telemetryKey: 'telemetry-key',
      telemetryHost: 'https://telemetry.example.com',
      userUUID: 'user-1',
    };

    const cleanup = trackUserTelemetry(routerEvents, config);
    cleanup();

    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
    expect(routerEvents.on).not.toHaveBeenCalled();
    expect(routerEvents.off).toHaveBeenCalledTimes(1);
  });

  it('captures custom client telemetry events when running in the browser', () => {
    captureUserTelemetryEvent('home_recommendation_item_drafted', {
      sourceResponseId: 11,
    });

    expect(posthog.capture).toHaveBeenCalledWith(
      'home_recommendation_item_drafted',
      { sourceResponseId: 11 },
    );
  });
});
