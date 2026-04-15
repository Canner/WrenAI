import { shouldRefetchConsoleHistory } from './ConsoleShellLayout';

describe('ConsoleShellLayout helpers', () => {
  it('refetches history when active thread is missing from sidebar cache', () => {
    expect(
      shouldRefetchConsoleHistory({
        activeHistoryId: '42',
        embedded: false,
        threadIds: [],
        attemptedHistoryId: null,
      }),
    ).toBe(true);
  });

  it('skips refetch when active thread already exists in sidebar cache', () => {
    expect(
      shouldRefetchConsoleHistory({
        activeHistoryId: '42',
        embedded: false,
        threadIds: ['42'],
        attemptedHistoryId: null,
      }),
    ).toBe(false);
  });

  it('skips duplicate refetch attempts for the same active thread', () => {
    expect(
      shouldRefetchConsoleHistory({
        activeHistoryId: '42',
        embedded: false,
        threadIds: [],
        attemptedHistoryId: '42',
      }),
    ).toBe(false);
  });
});
