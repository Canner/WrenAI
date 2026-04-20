export const HISTORICAL_SNAPSHOT_READONLY_HINT =
  '当前正在查看历史快照，仅支持浏览，不支持编辑或执行。';

type RuntimeSnapshotSelection = {
  selectorHasRuntime: boolean;
  currentKbSnapshotId?: string | null;
  defaultKbSnapshotId?: string | null;
};

export const hasLatestExecutableSnapshot = ({
  selectorHasRuntime,
  currentKbSnapshotId,
  defaultKbSnapshotId,
}: RuntimeSnapshotSelection) => {
  if (!selectorHasRuntime) {
    return false;
  }

  if (!defaultKbSnapshotId) {
    return true;
  }

  return currentKbSnapshotId === defaultKbSnapshotId;
};

export const isHistoricalSnapshotReadonly = ({
  selectorHasRuntime,
  currentKbSnapshotId,
  defaultKbSnapshotId,
}: RuntimeSnapshotSelection) =>
  Boolean(
    selectorHasRuntime &&
    defaultKbSnapshotId &&
    currentKbSnapshotId &&
    currentKbSnapshotId !== defaultKbSnapshotId,
  );
