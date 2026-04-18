import {
  isAbortRequestError,
  resolveAbortSafeErrorMessage,
} from './abort';

describe('abort utils', () => {
  it('detects serialized abort errors', () => {
    expect(
      isAbortRequestError({
        name: 'AbortError',
        message: 'signal is aborted without reason',
      }),
    ).toBe(true);
  });

  it('filters abort-like messages even when only the message string remains', () => {
    expect(
      resolveAbortSafeErrorMessage('signal is aborted without reason'),
    ).toBeNull();

    expect(
      resolveAbortSafeErrorMessage({
        message: 'This operation was aborted',
      }),
    ).toBeNull();
  });

  it('keeps non-abort messages intact', () => {
    expect(resolveAbortSafeErrorMessage({ message: 'boom' })).toBe('boom');
    expect(resolveAbortSafeErrorMessage(null, 'fallback')).toBe('fallback');
  });
});
