import {
  RestRequestCoordinator,
  normalizeRestRequestError,
} from './useRestRequest';
import { isAbortRequestError } from '@/utils/abort';

describe('RestRequestCoordinator', () => {
  it('aborts the previous request when a new one begins', () => {
    const coordinator = new RestRequestCoordinator();

    const first = coordinator.begin();
    expect(first.signal.aborted).toBe(false);
    expect(first.isCurrent()).toBe(true);

    const second = coordinator.begin();
    expect(first.signal.aborted).toBe(true);
    expect(first.signal.reason).toBeInstanceOf(DOMException);
    expect(first.signal.reason?.name).toBe('AbortError');
    expect(first.signal.reason?.message).toBe('superseded-by-new-request');
    expect(isAbortRequestError(first.signal.reason)).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it('clears the active controller after finalize and cancel', () => {
    const coordinator = new RestRequestCoordinator();

    const request = coordinator.begin();
    request.finalize();
    expect(request.isCurrent()).toBe(false);

    const next = coordinator.begin();
    coordinator.cancel();
    expect(next.signal.aborted).toBe(true);
    expect(next.signal.reason).toBeInstanceOf(DOMException);
    expect(next.signal.reason?.message).toBe('request-cancelled');
    expect(next.isCurrent()).toBe(false);
  });
});

describe('normalizeRestRequestError', () => {
  it('keeps Error instances and normalizes unknown failures', () => {
    const original = new Error('custom');
    expect(normalizeRestRequestError(original)).toBe(original);
    expect(normalizeRestRequestError('boom').message).toBe(
      '请求失败，请稍后重试。',
    );
  });
});
