import { NextApiRequest } from 'next';
import {
  Deploy,
  KBSnapshot,
  IKnowledgeBaseRepository,
  IKBSnapshotRepository,
  IProjectRepository,
  IWorkspaceRepository,
  KnowledgeBase,
  Project,
  Workspace,
} from '@server/repositories';
import { ActorClaims, IAuthService } from '@server/services/authService';
import { IDeployService } from '@server/services/deployService';
import { toPersistedRuntimeIdentityFromSource } from '@server/utils/persistedRuntimeIdentity';
import type { ResolvedRequestActor } from './actorClaims';

export interface RuntimeScopeSelector {
  runtimeScopeId?: string | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  bridgeProjectId?: number | null;
}

export interface RuntimeScope {
  source: 'explicit-request' | 'compatibility-runtime-shim';
  selector: RuntimeScopeSelector;
  project: Project | null;
  deployment: Deploy | null;
  deployHash: string | null;
  workspace: Workspace | null;
  knowledgeBase: KnowledgeBase | null;
  kbSnapshot: KBSnapshot | null;
  actorClaims: ActorClaims | null;
  userId: string | null;
  requestActor?: ResolvedRequestActor | null;
}

export interface PersistedRuntimeIdentity {
  projectId?: number | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
}

export class RuntimeScopeResolutionError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'RuntimeScopeResolutionError';
    this.statusCode = statusCode;
  }
}

export const toPersistedRuntimeIdentity = (
  runtimeScope?: RuntimeScope | null,
): PersistedRuntimeIdentity => {
  if (!runtimeScope) {
    throw new Error('Runtime scope is required for this operation');
  }

  return toPersistedRuntimeIdentityFromSource({
    projectId:
      runtimeScope.deployment?.projectId ?? runtimeScope.project?.id ?? null,
    workspaceId: runtimeScope.workspace?.id || null,
    knowledgeBaseId: runtimeScope.knowledgeBase?.id || null,
    kbSnapshotId: runtimeScope.kbSnapshot?.id || null,
    deployHash: runtimeScope.deployHash || null,
    actorUserId: runtimeScope.userId || null,
  });
};

export interface IRuntimeScopeResolver {
  resolveRequestScope(req: NextApiRequest): Promise<RuntimeScope>;
  resolveRuntimeScopeId(runtimeScopeId: string): Promise<RuntimeScope>;
}

export interface RuntimeScopeResolverDependencies {
  projectRepository: IProjectRepository;
  deployService: IDeployService;
  authService: IAuthService;
  workspaceRepository: IWorkspaceRepository;
  knowledgeBaseRepository: IKnowledgeBaseRepository;
  kbSnapshotRepository: IKBSnapshotRepository;
}
