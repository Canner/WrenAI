import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeSessionLaunchIdError, createNativeSessionLaunchId } from '../launchId';

describe('createNativeSessionLaunchId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the LAN-compatible secure entropy API when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (values: Uint8Array<ArrayBuffer>) => {
        values.set(Array.from({ length: 16 }, (_, index) => index));
      },
    });

    expect(createNativeSessionLaunchId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  it('uses getRandomValues to make an RFC 4122 v4 action ID when randomUUID is unavailable', () => {
    const id = createNativeSessionLaunchId({
      getRandomValues: (values) => {
        values.set(Array.from({ length: 16 }, (_, index) => index));
      },
    });

    expect(id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('does not weaken the launch action boundary when no secure entropy source exists', () => {
    expect(() => createNativeSessionLaunchId({})).toThrow(NativeSessionLaunchIdError);
  });
});
