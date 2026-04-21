import {
  PollingRequestCoordinator,
  normalizePollingRequestError,
  shouldRetryPollingRequestError,
} from './usePollingRequestLoop';

describe('usePollingRequestLoop helpers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('normalizes non-Error polling failures to a stable message', () => {
    expect(normalizePollingRequestError(new Error('boom'))).toEqual(
      new Error('boom'),
    );

    expect(normalizePollingRequestError('boom')).toEqual(
      new Error('请求失败，请稍后重试'),
    );
  });

  it('cancels the previous polling session when a new one begins', () => {
    const coordinator = new PollingRequestCoordinator();
    const firstSession = coordinator.begin();
    const secondSession = coordinator.begin();

    expect(firstSession.isCurrent()).toBe(false);
    expect(secondSession.isCurrent()).toBe(true);
  });

  it('runs only the latest scheduled polling callback', () => {
    const coordinator = new PollingRequestCoordinator();
    const firstCallback = jest.fn();
    const secondCallback = jest.fn();

    const firstSession = coordinator.begin();
    firstSession.scheduleNext(firstCallback, 120);
    const secondSession = coordinator.begin();
    secondSession.scheduleNext(secondCallback, 120);

    jest.advanceTimersByTime(120);

    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledTimes(1);
  });

  it('clears the pending polling callback when stopped', () => {
    const coordinator = new PollingRequestCoordinator();
    const callback = jest.fn();

    const session = coordinator.begin();
    session.scheduleNext(callback, 120);
    coordinator.stop();
    jest.advanceTimersByTime(120);

    expect(session.isCurrent()).toBe(false);
    expect(callback).not.toHaveBeenCalled();
  });

  it('stops scheduling the next poll when shouldContinue returns false', () => {
    const coordinator = new PollingRequestCoordinator();
    const callback = jest.fn();
    const session = coordinator.begin();
    const shouldContinue = jest.fn().mockReturnValue(false);

    if (shouldContinue({ status: 'FINISHED' })) {
      session.scheduleNext(callback, 120);
    }

    jest.advanceTimersByTime(120);

    expect(shouldContinue).toHaveBeenCalledWith({ status: 'FINISHED' });
    expect(callback).not.toHaveBeenCalled();
  });

  it('retries transient polling errors only when explicitly allowed', () => {
    const transientError = new Error('transient');

    expect(
      shouldRetryPollingRequestError({
        error: transientError,
      }),
    ).toBe(false);

    expect(
      shouldRetryPollingRequestError({
        error: transientError,
        shouldContinueOnError: () => true,
      }),
    ).toBe(true);
  });
});
