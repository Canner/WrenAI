import {
  hasLatestExecutableSnapshot,
  isHistoricalSnapshotReadonly,
} from './runtimeSnapshot';

describe('runtimeSnapshot helpers', () => {
  it('treats the default snapshot as the only latest executable snapshot', () => {
    expect(
      hasLatestExecutableSnapshot({
        selectorHasRuntime: true,
        currentKbSnapshotId: 'snap-latest',
        defaultKbSnapshotId: 'snap-latest',
      }),
    ).toBe(true);

    expect(
      hasLatestExecutableSnapshot({
        selectorHasRuntime: true,
        currentKbSnapshotId: 'snap-old',
        defaultKbSnapshotId: 'snap-latest',
      }),
    ).toBe(false);
  });

  it('marks non-default snapshots as readonly', () => {
    expect(
      isHistoricalSnapshotReadonly({
        selectorHasRuntime: true,
        currentKbSnapshotId: 'snap-old',
        defaultKbSnapshotId: 'snap-latest',
      }),
    ).toBe(true);

    expect(
      isHistoricalSnapshotReadonly({
        selectorHasRuntime: true,
        currentKbSnapshotId: 'snap-latest',
        defaultKbSnapshotId: 'snap-latest',
      }),
    ).toBe(false);
  });
});
