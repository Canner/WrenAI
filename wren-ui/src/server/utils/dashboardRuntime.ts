import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  normalizeCanonicalPersistedRuntimeIdentity,
  toPersistedRuntimeIdentityFromSource,
} from '@server/utils/persistedRuntimeIdentity';
import {
  Dashboard,
  Deploy,
  IKnowledgeBaseRepository,
  IKBSnapshotRepository,
  KBSnapshot,
  Project,
} from '@server/repositories';
import { IDeployService, IProjectService } from '@server/services';

export interface ResolvedDashboardRuntime {
  kbSnapshot: KBSnapshot | null;
  knowledgeBaseId: string | null;
  kbSnapshotId: string | null;
  projectBridgeFallbackId: number | null;
  deployHash: string | null;
}

export interface DashboardRuntimeBinding {
  workspaceId: string | null;
  knowledgeBaseId: string | null;
  kbSnapshotId: string | null;
  deployHash: string | null;
  createdBy: string | null;
}

export const resolveDashboardRuntime = async ({
  dashboard,
  kbSnapshotRepository,
}: {
  dashboard: Dashboard;
  kbSnapshotRepository: IKBSnapshotRepository;
}): Promise<ResolvedDashboardRuntime> => {
  const kbSnapshot = dashboard.kbSnapshotId
    ? await kbSnapshotRepository.findOneBy({ id: dashboard.kbSnapshotId })
    : null;

  return {
    kbSnapshot,
    knowledgeBaseId:
      dashboard.knowledgeBaseId ?? kbSnapshot?.knowledgeBaseId ?? null,
    kbSnapshotId: dashboard.kbSnapshotId ?? null,
    projectBridgeFallbackId: dashboard.projectId ?? null,
    deployHash: dashboard.deployHash || kbSnapshot?.deployHash || null,
  };
};

export interface DashboardExecutionContext {
  runtime: ResolvedDashboardRuntime;
  runtimeIdentity: PersistedRuntimeIdentity;
  project: Project;
  deployment: Deploy;
  manifest: any;
}

const normalizeDashboardLookupRuntimeIdentity = (
  runtimeIdentity: PersistedRuntimeIdentity,
): PersistedRuntimeIdentity =>
  normalizeCanonicalPersistedRuntimeIdentity(runtimeIdentity);

const RUNTIME_IDENTITY_SOURCE_KEYS: Array<keyof PersistedRuntimeIdentity> = [
  'projectId',
  'workspaceId',
  'knowledgeBaseId',
  'kbSnapshotId',
  'deployHash',
  'actorUserId',
];

const hasOwnRuntimeIdentityField = (
  source: Partial<PersistedRuntimeIdentity> | null | undefined,
  key: keyof PersistedRuntimeIdentity,
) => Boolean(source && Object.prototype.hasOwnProperty.call(source, key));

const hasRuntimeIdentitySource = (
  source: Partial<PersistedRuntimeIdentity> | null | undefined,
) =>
  RUNTIME_IDENTITY_SOURCE_KEYS.some((key) =>
    hasOwnRuntimeIdentityField(source, key),
  );

const pickRuntimeIdentityField = <T extends keyof PersistedRuntimeIdentity>(
  source: Partial<PersistedRuntimeIdentity> | null | undefined,
  key: T,
  fallback: PersistedRuntimeIdentity[T],
) =>
  hasOwnRuntimeIdentityField(source, key)
    ? ((source?.[key] ?? null) as PersistedRuntimeIdentity[T])
    : fallback;

export const resolveDashboardExecutionContext = async ({
  dashboard,
  kbSnapshotRepository,
  projectService,
  deployService,
  requestRuntimeIdentity,
  runtimeIdentitySource,
  responseRuntimeIdentity,
}: {
  dashboard: Dashboard;
  kbSnapshotRepository: IKBSnapshotRepository;
  projectService: Pick<IProjectService, 'getProjectById'>;
  deployService: Pick<IDeployService, 'getDeploymentByRuntimeIdentity'>;
  requestRuntimeIdentity?: PersistedRuntimeIdentity | null;
  runtimeIdentitySource?: Partial<PersistedRuntimeIdentity> | null;
  responseRuntimeIdentity?: Partial<PersistedRuntimeIdentity> | null;
}): Promise<DashboardExecutionContext> => {
  const runtime = await resolveDashboardRuntime({
    dashboard,
    kbSnapshotRepository,
  });
  const resolvedRuntimeIdentitySource =
    runtimeIdentitySource || responseRuntimeIdentity || null;
  const runtimeIdentityFallback = hasRuntimeIdentitySource(
    resolvedRuntimeIdentitySource,
  )
    ? null
    : requestRuntimeIdentity;

  let runtimeIdentity: PersistedRuntimeIdentity;
  try {
    runtimeIdentity = normalizeDashboardLookupRuntimeIdentity(
      toPersistedRuntimeIdentityFromSource(
        {
          projectId: pickRuntimeIdentityField(
            resolvedRuntimeIdentitySource,
            'projectId',
            runtime.projectBridgeFallbackId ?? null,
          ),
          workspaceId: pickRuntimeIdentityField(
            resolvedRuntimeIdentitySource,
            'workspaceId',
            requestRuntimeIdentity?.workspaceId ?? null,
          ),
          knowledgeBaseId: pickRuntimeIdentityField(
            resolvedRuntimeIdentitySource,
            'knowledgeBaseId',
            runtime.knowledgeBaseId,
          ),
          kbSnapshotId: pickRuntimeIdentityField(
            resolvedRuntimeIdentitySource,
            'kbSnapshotId',
            runtime.kbSnapshotId,
          ),
          deployHash: pickRuntimeIdentityField(
            resolvedRuntimeIdentitySource,
            'deployHash',
            runtime.deployHash ?? null,
          ),
          actorUserId: pickRuntimeIdentityField(
            resolvedRuntimeIdentitySource,
            'actorUserId',
            requestRuntimeIdentity?.actorUserId ?? null,
          ),
        },
        runtimeIdentityFallback,
      ),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Persisted runtime identity requires projectId'
    ) {
      throw new Error(
        `Dashboard ${dashboard.id} is missing a project runtime binding`,
      );
    }
    throw error;
  }

  const deployment = await deployService.getDeploymentByRuntimeIdentity({
    projectId: runtimeIdentity.projectId,
    workspaceId: runtimeIdentity.workspaceId,
    knowledgeBaseId: runtimeIdentity.knowledgeBaseId,
    kbSnapshotId: runtimeIdentity.kbSnapshotId,
    deployHash: runtimeIdentity.deployHash,
  });

  if (!deployment) {
    throw new Error('No deployment found, please deploy your project first');
  }

  const project = await projectService.getProjectById(deployment.projectId);

  return {
    runtime,
    runtimeIdentity: {
      ...runtimeIdentity,
      projectId: deployment.projectId,
      deployHash: runtimeIdentity.deployHash ?? deployment.hash,
    },
    project,
    deployment,
    manifest: deployment.manifest,
  };
};

export const getDashboardRuntimeBinding = (
  runtimeIdentity: PersistedRuntimeIdentity,
): DashboardRuntimeBinding => ({
  workspaceId: runtimeIdentity.workspaceId || null,
  knowledgeBaseId: runtimeIdentity.knowledgeBaseId || null,
  kbSnapshotId: runtimeIdentity.kbSnapshotId || null,
  deployHash: runtimeIdentity.deployHash || null,
  createdBy: runtimeIdentity.actorUserId || null,
});

export const resolveDashboardScheduleBinding = async ({
  dashboard,
  runtimeIdentity,
  kbSnapshotRepository,
  knowledgeBaseRepository,
}: {
  dashboard: Dashboard;
  runtimeIdentity: PersistedRuntimeIdentity;
  kbSnapshotRepository: IKBSnapshotRepository;
  knowledgeBaseRepository: Pick<IKnowledgeBaseRepository, 'findOneBy'>;
}): Promise<DashboardRuntimeBinding> => {
  const runtime = await resolveDashboardRuntime({
    dashboard,
    kbSnapshotRepository,
  });
  const hasDashboardRuntimeBinding = Boolean(
    runtime.knowledgeBaseId || runtime.kbSnapshotId || runtime.deployHash,
  );
  if (!hasDashboardRuntimeBinding) {
    return {
      workspaceId: runtimeIdentity.workspaceId || null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
      createdBy: dashboard.createdBy || runtimeIdentity.actorUserId || null,
    };
  }
  const knowledgeBaseId =
    runtime.knowledgeBaseId || runtimeIdentity.knowledgeBaseId || null;
  let workspaceId = runtimeIdentity.workspaceId || null;

  if (
    knowledgeBaseId &&
    (!workspaceId || knowledgeBaseId !== runtimeIdentity.knowledgeBaseId)
  ) {
    const knowledgeBase = await knowledgeBaseRepository.findOneBy({
      id: knowledgeBaseId,
    });
    workspaceId = knowledgeBase?.workspaceId || workspaceId;
  }

  return {
    workspaceId,
    knowledgeBaseId,
    kbSnapshotId: runtime.kbSnapshotId || runtimeIdentity.kbSnapshotId || null,
    deployHash: runtime.deployHash || runtimeIdentity.deployHash || null,
    createdBy: dashboard.createdBy || runtimeIdentity.actorUserId || null,
  };
};
