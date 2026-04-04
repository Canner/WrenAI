import { Dashboard, IKBSnapshotRepository, KBSnapshot } from '@server/repositories';

export interface ResolvedDashboardRuntime {
  kbSnapshot: KBSnapshot | null;
  projectId: number | null;
  deployHash: string | null;
}

export const resolveDashboardRuntime = async ({
  dashboard,
  kbSnapshotRepository,
}: {
  dashboard: Dashboard;
  kbSnapshotRepository: IKBSnapshotRepository;
}): Promise<ResolvedDashboardRuntime> => {
  const kbSnapshot =
    dashboard.kbSnapshotId
      ? await kbSnapshotRepository.findOneBy({ id: dashboard.kbSnapshotId })
      : null;

  return {
    kbSnapshot,
    projectId: kbSnapshot?.legacyProjectId ?? dashboard.projectId ?? null,
    deployHash: dashboard.deployHash || kbSnapshot?.deployHash || null,
  };
};
