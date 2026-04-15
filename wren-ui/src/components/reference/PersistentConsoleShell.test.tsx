import {
  resolvePersistentShellActiveHistoryId,
  resolvePersistentShellActiveNav,
  shouldKeyRuntimeScopePage,
  shouldUsePersistentConsoleShell,
} from './PersistentConsoleShell';

describe('PersistentConsoleShell helpers', () => {
  it('only enables persistent shell on console-style routes', () => {
    expect(shouldUsePersistentConsoleShell('/home')).toBe(true);
    expect(shouldUsePersistentConsoleShell('/home/[id]')).toBe(true);
    expect(shouldUsePersistentConsoleShell('/knowledge')).toBe(true);
    expect(shouldUsePersistentConsoleShell('/workspace/schedules')).toBe(false);
    expect(shouldUsePersistentConsoleShell('/workspace')).toBe(false);
    expect(shouldUsePersistentConsoleShell('/settings')).toBe(false);
    expect(shouldUsePersistentConsoleShell('/settings/skills')).toBe(false);
    expect(shouldUsePersistentConsoleShell('/auth')).toBe(false);
  });

  it('does not force runtime-scope remounts on persistent shell routes', () => {
    expect(shouldKeyRuntimeScopePage('/home')).toBe(false);
    expect(shouldKeyRuntimeScopePage('/knowledge')).toBe(false);
    expect(shouldKeyRuntimeScopePage('/workspace')).toBe(true);
    expect(shouldKeyRuntimeScopePage('/settings')).toBe(true);
    expect(shouldKeyRuntimeScopePage('/auth')).toBe(true);
  });

  it('resolves the expected active nav item from pathname', () => {
    expect(resolvePersistentShellActiveNav('/home')).toBe('home');
    expect(resolvePersistentShellActiveNav('/home/dashboard')).toBe(
      'dashboard',
    );
    expect(resolvePersistentShellActiveNav('/settings/skills')).toBeUndefined();
    expect(resolvePersistentShellActiveNav('/workspace')).toBeUndefined();
    expect(resolvePersistentShellActiveNav('/home/[id]')).toBeUndefined();
  });

  it('only marks history items active on thread routes', () => {
    expect(
      resolvePersistentShellActiveHistoryId({
        pathname: '/home/[id]',
        queryId: '12',
      }),
    ).toBe('12');
    expect(
      resolvePersistentShellActiveHistoryId({
        pathname: '/home/[id]',
        queryId: ['18'],
      }),
    ).toBe('18');
    expect(
      resolvePersistentShellActiveHistoryId({
        pathname: '/home',
        queryId: '12',
      }),
    ).toBeNull();
  });
});
