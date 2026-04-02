import { NextApiRequest } from 'next';
import {
  Deploy,
  IDeployLogRepository,
  IKnowledgeBaseRepository,
  IKBSnapshotRepository,
  IProjectRepository,
  IWorkspaceRepository,
  KBSnapshot,
  KnowledgeBase,
  Project,
  Workspace,
} from '@server/repositories';
import { ActorClaims, IAuthService } from '@server/services/authService';
import { IDeployService } from '@server/services/deployService';
import { ResolvedRequestActor, resolveRequestActor } from './actorClaims';

const BODY_KEYS = {
  workspaceId: ['workspaceId', 'workspace_id'],
  knowledgeBaseId: ['knowledgeBaseId', 'knowledge_base_id'],
  kbSnapshotId: ['kbSnapshotId', 'kb_snapshot_id'],
  deployHash: ['deployHash', 'deploy_hash'],
  projectId: ['projectId', 'project_id', 'legacyProjectId', 'legacy_project_id'],
} as const;

const HEADER_KEYS = {
  workspaceId: ['x-wren-workspace-id', 'x-workspace-id'],
  knowledgeBaseId: ['x-wren-knowledge-base-id', 'x-knowledge-base-id'],
  kbSnapshotId: ['x-wren-kb-snapshot-id', 'x-kb-snapshot-id'],
  deployHash: ['x-wren-deploy-hash', 'x-deploy-hash'],
  projectId: ['x-wren-project-id', 'x-project-id'],
} as const;

const readValueFromObject = (
  source: Record<string, any> | undefined | null,
  keys: readonly string[],
): string | null => {
  if (!source) {
    return null;
  }

  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      if (value[0]) {
        return String(value[0]);
      }
      continue;
    }
    if (value !== undefined && value !== null && `${value}`.trim() !== '') {
      return String(value);
    }
  }

  return null;
};

const readHeaderValue = (
  headers: NextApiRequest['headers'],
  keys: readonly string[],
): string | null => {
  for (const key of keys) {
    const value = headers[key];
    if (Array.isArray(value)) {
      if (value[0]) {
        return value[0];
      }
      continue;
    }
    if (value) {
      return value;
    }
  }

  return null;
};

const coerceInteger = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

export interface RuntimeScopeSelector {
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  legacyProjectId?: number | null;
}

export interface RuntimeScope {
  source: 'explicit-request' | 'legacy-project-shim';
  selector: RuntimeScopeSelector;
  project: Project;
  deployment: Deploy | null;
  deployHash: string | null;
  workspace: Workspace | null;
  knowledgeBase: KnowledgeBase | null;
  kbSnapshot: KBSnapshot | null;
  actorClaims: ActorClaims | null;
  userId: string | null;
}

export interface PersistedRuntimeIdentity {
  projectId: number;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
}

export interface ResolveRequestScopeOptions {
  allowLegacyProjectShim?: boolean;
}

class RuntimeScopeResolutionError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'RuntimeScopeResolutionError';
    this.statusCode = statusCode;
  }
}

export const toPersistedRuntimeIdentity = (
  runtimeScope: RuntimeScope,
): PersistedRuntimeIdentity => ({
  projectId: runtimeScope.project.id,
  workspaceId: runtimeScope.workspace?.id || null,
  knowledgeBaseId: runtimeScope.knowledgeBase?.id || null,
  kbSnapshotId: runtimeScope.kbSnapshot?.id || null,
  deployHash: runtimeScope.deployHash || null,
  actorUserId: runtimeScope.userId || null,
});

export interface IRuntimeScopeResolver {
  resolveRequestScope(
    req: NextApiRequest,
    options?: ResolveRequestScopeOptions,
  ): Promise<RuntimeScope>;
}

export class RuntimeScopeResolver implements IRuntimeScopeResolver {
  private projectRepository: IProjectRepository;
  private deployRepository: IDeployLogRepository;
  private deployService: IDeployService;
  private authService: IAuthService;
  private workspaceRepository: IWorkspaceRepository;
  private knowledgeBaseRepository: IKnowledgeBaseRepository;
  private kbSnapshotRepository: IKBSnapshotRepository;

  constructor({
    projectRepository,
    deployRepository,
    deployService,
    authService,
    workspaceRepository,
    knowledgeBaseRepository,
    kbSnapshotRepository,
  }: {
    projectRepository: IProjectRepository;
    deployRepository: IDeployLogRepository;
    deployService: IDeployService;
    authService: IAuthService;
    workspaceRepository: IWorkspaceRepository;
    knowledgeBaseRepository: IKnowledgeBaseRepository;
    kbSnapshotRepository: IKBSnapshotRepository;
  }) {
    this.projectRepository = projectRepository;
    this.deployRepository = deployRepository;
    this.deployService = deployService;
    this.authService = authService;
    this.workspaceRepository = workspaceRepository;
    this.knowledgeBaseRepository = knowledgeBaseRepository;
    this.kbSnapshotRepository = kbSnapshotRepository;
  }

  public async resolveRequestScope(
    req: NextApiRequest,
    options: ResolveRequestScopeOptions = {},
  ): Promise<RuntimeScope> {
    const selector = this.readSelector(req);
    const actor = await resolveRequestActor({
      req,
      authService: this.authService,
      workspaceId: selector.workspaceId,
    });

    if (this.hasExplicitSelector(selector)) {
      return await this.resolveExplicitScope(selector, actor);
    }

    if (!options.allowLegacyProjectShim) {
      throw new RuntimeScopeResolutionError(
        'Runtime scope selector is required for this request',
      );
    }

    return await this.resolveLegacyProjectScope(actor);
  }

  private readSelector(req: NextApiRequest): RuntimeScopeSelector {
    const body =
      req.body && typeof req.body === 'object'
        ? (req.body as Record<string, any>)
        : undefined;
    const bodyVariables =
      body?.variables && typeof body.variables === 'object'
        ? (body.variables as Record<string, any>)
        : undefined;
    const query = req.query as Record<string, any>;

    return {
      workspaceId:
        readValueFromObject(body, BODY_KEYS.workspaceId) ||
        readValueFromObject(bodyVariables, BODY_KEYS.workspaceId) ||
        readValueFromObject(query, BODY_KEYS.workspaceId) ||
        readHeaderValue(req.headers, HEADER_KEYS.workspaceId),
      knowledgeBaseId:
        readValueFromObject(body, BODY_KEYS.knowledgeBaseId) ||
        readValueFromObject(bodyVariables, BODY_KEYS.knowledgeBaseId) ||
        readValueFromObject(query, BODY_KEYS.knowledgeBaseId) ||
        readHeaderValue(req.headers, HEADER_KEYS.knowledgeBaseId),
      kbSnapshotId:
        readValueFromObject(body, BODY_KEYS.kbSnapshotId) ||
        readValueFromObject(bodyVariables, BODY_KEYS.kbSnapshotId) ||
        readValueFromObject(query, BODY_KEYS.kbSnapshotId) ||
        readHeaderValue(req.headers, HEADER_KEYS.kbSnapshotId),
      deployHash:
        readValueFromObject(body, BODY_KEYS.deployHash) ||
        readValueFromObject(bodyVariables, BODY_KEYS.deployHash) ||
        readValueFromObject(query, BODY_KEYS.deployHash) ||
        readHeaderValue(req.headers, HEADER_KEYS.deployHash),
      legacyProjectId: coerceInteger(
        readValueFromObject(body, BODY_KEYS.projectId) ||
          readValueFromObject(bodyVariables, BODY_KEYS.projectId) ||
          readValueFromObject(query, BODY_KEYS.projectId) ||
          readHeaderValue(req.headers, HEADER_KEYS.projectId),
      ),
    };
  }

  private hasExplicitSelector(selector: RuntimeScopeSelector): boolean {
    return Boolean(
      selector.workspaceId ||
        selector.knowledgeBaseId ||
        selector.kbSnapshotId ||
        selector.deployHash ||
        selector.legacyProjectId,
    );
  }

  private async resolveExplicitScope(
    selector: RuntimeScopeSelector,
    actor: ResolvedRequestActor,
  ): Promise<RuntimeScope> {
    let kbSnapshot = selector.kbSnapshotId
      ? await this.kbSnapshotRepository.findOneBy({ id: selector.kbSnapshotId })
      : null;

    if (!kbSnapshot && selector.knowledgeBaseId && selector.deployHash) {
      kbSnapshot = await this.kbSnapshotRepository.findOneBy({
        knowledgeBaseId: selector.knowledgeBaseId,
        deployHash: selector.deployHash,
      });
    }

    if (!kbSnapshot && selector.legacyProjectId) {
      kbSnapshot = await this.kbSnapshotRepository.findOneBy({
        legacyProjectId: selector.legacyProjectId,
      });
    }

    let knowledgeBase = kbSnapshot
      ? await this.knowledgeBaseRepository.findOneBy({
          id: kbSnapshot.knowledgeBaseId,
        })
      : null;

    if (!knowledgeBase && selector.knowledgeBaseId) {
      knowledgeBase = await this.knowledgeBaseRepository.findOneBy({
        id: selector.knowledgeBaseId,
      });
    }

    if (
      knowledgeBase?.defaultKbSnapshotId &&
      !kbSnapshot &&
      knowledgeBase.id === selector.knowledgeBaseId
    ) {
      kbSnapshot = await this.kbSnapshotRepository.findOneBy({
        id: knowledgeBase.defaultKbSnapshotId,
      });
    }

    if (
      selector.knowledgeBaseId &&
      kbSnapshot &&
      kbSnapshot.knowledgeBaseId !== selector.knowledgeBaseId
    ) {
      throw new Error('kb_snapshot does not belong to the requested knowledge base');
    }

    const workspaceId = selector.workspaceId || knowledgeBase?.workspaceId || null;

    const workspace = workspaceId
      ? await this.workspaceRepository.findOneBy({ id: workspaceId })
      : null;

    if (
      !workspace &&
      (selector.workspaceId || selector.knowledgeBaseId || selector.kbSnapshotId)
    ) {
      throw new Error('Workspace scope could not be resolved');
    }

    if (knowledgeBase && workspace && knowledgeBase.workspaceId !== workspace.id) {
      throw new Error('Knowledge base does not belong to the requested workspace');
    }

    if (actor.actorClaims && workspace && actor.actorClaims.workspaceId !== workspace.id) {
      throw new Error('Session workspace does not match requested workspace');
    }

    const project = await this.resolveProjectForScope(selector, kbSnapshot);
    if (!project) {
      throw new Error('Legacy project bridge is required for runtime execution');
    }

    const deployment = await this.resolveDeploymentForScope(
      project.id,
      selector.deployHash || kbSnapshot?.deployHash || null,
    );
    if (!deployment && (selector.deployHash || kbSnapshot?.deployHash)) {
      throw new Error('No deployment found for the requested runtime scope');
    }

    if (
      kbSnapshot &&
      selector.deployHash &&
      kbSnapshot.deployHash !== selector.deployHash
    ) {
      throw new Error('deploy_hash does not match the requested kb_snapshot');
    }

    return {
      source: 'explicit-request',
      selector: {
        workspaceId: workspace?.id || null,
        knowledgeBaseId: knowledgeBase?.id || null,
        kbSnapshotId: kbSnapshot?.id || null,
        deployHash: deployment?.hash || null,
        legacyProjectId: project.id,
      },
      project,
      deployment,
      deployHash: deployment?.hash || null,
      workspace,
      knowledgeBase,
      kbSnapshot,
      actorClaims: actor.actorClaims,
      userId: actor.userId,
    };
  }

  private async resolveLegacyProjectScope(
    actor: ResolvedRequestActor,
  ): Promise<RuntimeScope> {
    // Bootstrap-only bridge for legacy current-project flows.
    // Runtime APIs should require an explicit selector instead.
    const project = await this.projectRepository.getCurrentProject();
    const deployment = await this.deployService.getLastDeployment(project.id);

    const kbSnapshot = await this.kbSnapshotRepository.findOneBy({
      legacyProjectId: project.id,
    });
    const knowledgeBase = kbSnapshot
      ? await this.knowledgeBaseRepository.findOneBy({
          id: kbSnapshot.knowledgeBaseId,
        })
      : null;
    const workspaceId = knowledgeBase?.workspaceId || actor.workspaceId || null;
    const workspace = workspaceId
      ? await this.workspaceRepository.findOneBy({ id: workspaceId })
      : null;

    if (actor.actorClaims && workspace && actor.actorClaims.workspaceId !== workspace.id) {
      throw new Error('Session workspace does not match requested workspace');
    }

    return {
      source: 'legacy-project-shim',
      selector: {
        workspaceId: workspace?.id || null,
        knowledgeBaseId: knowledgeBase?.id || null,
        kbSnapshotId: kbSnapshot?.id || null,
        deployHash: deployment?.hash || null,
        legacyProjectId: project.id,
      },
      project,
      deployment,
      deployHash: deployment?.hash || null,
      workspace,
      knowledgeBase,
      kbSnapshot,
      actorClaims: actor.actorClaims,
      userId: actor.userId,
    };
  }

  private async resolveProjectForScope(
    selector: RuntimeScopeSelector,
    kbSnapshot: KBSnapshot | null,
  ): Promise<Project | null> {
    const legacyProjectId = selector.legacyProjectId || kbSnapshot?.legacyProjectId;
    if (legacyProjectId) {
      return await this.projectRepository.findOneBy({ id: legacyProjectId });
    }

    if (selector.deployHash) {
      const deployment = await this.deployRepository.findOneBy({
        hash: selector.deployHash,
      });
      if (deployment) {
        return await this.projectRepository.findOneBy({ id: deployment.projectId });
      }
    }

    return null;
  }

  private async resolveDeploymentForScope(
    projectId: number,
    deployHash?: string | null,
  ): Promise<Deploy | null> {
    if (deployHash) {
      const deployment = await this.deployRepository.findOneBy({
        projectId,
        hash: deployHash,
      });
      if (deployment) {
        return deployment;
      }
    }

    return await this.deployService.getLastDeployment(projectId);
  }
}
