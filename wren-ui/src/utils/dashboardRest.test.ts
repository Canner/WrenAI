import { resolveDashboardDisplayName } from './dashboardRest';

describe('resolveDashboardDisplayName', () => {
  it('normalizes legacy default dashboard storage name', () => {
    expect(resolveDashboardDisplayName('Dashboard')).toBe('默认看板');
  });

  it('falls back to default dashboard when the stored name is empty', () => {
    expect(resolveDashboardDisplayName('')).toBe('默认看板');
    expect(resolveDashboardDisplayName(null)).toBe('默认看板');
  });

  it('keeps custom dashboard names unchanged', () => {
    expect(resolveDashboardDisplayName('经营总览')).toBe('经营总览');
  });
});
