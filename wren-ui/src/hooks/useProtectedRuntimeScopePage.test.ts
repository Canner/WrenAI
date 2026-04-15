import { Path } from '@/utils/enum';
import { resolveProtectedRuntimeScopeRedirect } from './useProtectedRuntimeScopePage';

describe('resolveProtectedRuntimeScopeRedirect', () => {
  it('waits while router or auth session is still bootstrapping', () => {
    expect(
      resolveProtectedRuntimeScopeRedirect({
        routerReady: false,
        authLoading: true,
        authenticated: false,
        hasRuntimeScope: false,
      }),
    ).toBeNull();
  });

  it('redirects unauthenticated users to auth', () => {
    expect(
      resolveProtectedRuntimeScopeRedirect({
        routerReady: true,
        authLoading: false,
        authenticated: false,
        hasRuntimeScope: false,
      }),
    ).toBe(Path.Auth);
  });

  it('redirects authenticated users without runtime scope to onboarding', () => {
    expect(
      resolveProtectedRuntimeScopeRedirect({
        routerReady: true,
        authLoading: false,
        authenticated: true,
        hasRuntimeScope: false,
      }),
    ).toBe(Path.OnboardingConnection);
  });

  it('allows authenticated users with runtime scope to continue', () => {
    expect(
      resolveProtectedRuntimeScopeRedirect({
        routerReady: true,
        authLoading: false,
        authenticated: true,
        hasRuntimeScope: true,
      }),
    ).toBeNull();
  });
});
