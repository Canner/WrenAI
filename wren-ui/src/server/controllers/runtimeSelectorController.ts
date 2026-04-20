import { IContext } from '../types';
import { KBSnapshot, KnowledgeBase, Workspace } from '../repositories';
import {
  resolveBootstrapKnowledgeBaseSelection,
  resolveKnowledgeBaseSnapshotSelection,
} from '@server/utils/runtimeSelectorState';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  recordAuditEvent,
} from '@server/authz';
import { resolveKnowledgeBaseAssetCountMap } from '@server/utils/knowledgeBaseAssetMetrics';

const sortByStringField = <T extends Record<string, any>>(
  items: T[],
  field: keyof T,
) =>
  [...items].sort((left, right) =>
    String(left[field] || '').localeCompare(String(right[field] || '')),
  );

const toWorkspaceView = (workspace: Workspace | null | undefined) =>
  workspace
    ? {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        kind: workspace.kind || null,
      }
    : null;

const toKnowledgeBaseView = (
  knowledgeBase: KnowledgeBase | null | undefined,
  assetCount?: number,
) =>
  knowledgeBase
    ? {
        id: knowledgeBase.id,
        slug: knowledgeBase.slug,
        name: knowledgeBase.name,
        kind: knowledgeBase.kind || null,
        defaultKbSnapshotId: knowledgeBase.defaultKbSnapshotId || null,
        assetCount,
      }
    : null;

const toKBSnapshotView = (kbSnapshot: KBSnapshot | null | undefined) =>
  kbSnapshot
    ? {
        id: kbSnapshot.id,
        snapshotKey: kbSnapshot.snapshotKey,
        displayName: kbSnapshot.displayName,
        deployHash: kbSnapshot.deployHash,
        status: kbSnapshot.status,
      }
    : null;

const requireAuthorizationActor = (ctx: IContext) =>
  ctx.authorizationActor ||
  ctx.requestActor?.authorizationActor ||
  buildAuthorizationActorFromRuntimeScope(ctx.runtimeScope);

export class RuntimeSelectorController {
  getRuntimeSelectorState = async ({ ctx }: { ctx: IContext }) => {
    const runtimeScope = ctx.runtimeScope;
    let currentWorkspace = runtimeScope?.workspace || null;
    let currentKnowledgeBase = runtimeScope?.knowledgeBase || null;
    let currentKbSnapshot = runtimeScope?.kbSnapshot || null;

    if (!currentWorkspace && ctx.requestActor?.workspaceId) {
      currentWorkspace = await ctx.workspaceRepository.findOneBy({
        id: ctx.requestActor.workspaceId,
      });
    }

    if (!currentWorkspace) {
      return null;
    }

    const actor = requireAuthorizationActor(ctx);
    const workspaceResource = {
      resourceType: 'workspace',
      resourceId: currentWorkspace.id,
      workspaceId: currentWorkspace.id,
      attributes: {
        workspaceKind: currentWorkspace.kind || null,
      },
    };

    await assertAuthorizedWithAudit({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'workspace.read',
      resource: workspaceResource,
    });

    const userWorkspaces =
      ctx.requestActor?.userId && ctx.workspaceService?.listWorkspacesForUser
        ? await ctx.workspaceService.listWorkspacesForUser(
            ctx.requestActor.userId,
          )
        : [];
    const visibleWorkspaces = userWorkspaces.filter(
      (workspace) =>
        workspace.status === 'active' || workspace.id === currentWorkspace?.id,
    );
    const currentWorkspaceId = currentWorkspace.id;
    const mergedWorkspaces = currentWorkspace
      ? [
          ...visibleWorkspaces,
          ...(!visibleWorkspaces.some(
            (workspace) => workspace.id === currentWorkspaceId,
          )
            ? [currentWorkspace]
            : []),
        ]
      : visibleWorkspaces;
    const sortedWorkspaces = sortByStringField(mergedWorkspaces, 'name');

    const workspaceKnowledgeBases = await ctx.knowledgeBaseRepository.findAllBy(
      {
        workspaceId: currentWorkspace.id,
      },
    );

    if (
      currentKnowledgeBase &&
      currentKnowledgeBase.workspaceId !== currentWorkspace.id
    ) {
      currentKnowledgeBase = null;
      currentKbSnapshot = null;
    }

    if (
      currentKbSnapshot &&
      (!currentKnowledgeBase ||
        currentKbSnapshot.knowledgeBaseId !== currentKnowledgeBase.id)
    ) {
      currentKbSnapshot = null;
    }

    const visibleKnowledgeBases = workspaceKnowledgeBases.filter(
      (knowledgeBase) =>
        !knowledgeBase.archivedAt ||
        knowledgeBase.id === currentKnowledgeBase?.id,
    );
    const currentKnowledgeBaseId = currentKnowledgeBase?.id;
    const mergedKnowledgeBases = currentKnowledgeBase
      ? [
          ...visibleKnowledgeBases,
          ...(!visibleKnowledgeBases.some(
            (knowledgeBase) => knowledgeBase.id === currentKnowledgeBaseId,
          )
            ? [currentKnowledgeBase]
            : []),
        ]
      : visibleKnowledgeBases;
    const sortedKnowledgeBases = sortByStringField(
      mergedKnowledgeBases,
      'name',
    );
    const knowledgeBaseAssetCountMap = await resolveKnowledgeBaseAssetCountMap({
      knowledgeBases: sortedKnowledgeBases,
      kbSnapshotRepository: ctx.kbSnapshotRepository,
      modelRepository: ctx.modelRepository,
      viewRepository: ctx.viewRepository,
    });

    const hasExecutableCurrentSelection = Boolean(
      currentKbSnapshot?.id ||
      runtimeScope?.deployment?.hash ||
      runtimeScope?.deployHash,
    );

    if (currentKnowledgeBase && !hasExecutableCurrentSelection) {
      const { snapshot } = await resolveKnowledgeBaseSnapshotSelection({
        knowledgeBase: currentKnowledgeBase,
        kbSnapshotRepository: ctx.kbSnapshotRepository,
        deployLogRepository: ctx.deployRepository,
      });

      if (snapshot) {
        currentKbSnapshot = snapshot;
      } else {
        const bootstrapSelection = await resolveBootstrapKnowledgeBaseSelection(
          sortedKnowledgeBases,
          ctx.kbSnapshotRepository,
          ctx.deployRepository,
        );
        currentKnowledgeBase = bootstrapSelection.knowledgeBase;
        currentKbSnapshot = bootstrapSelection.snapshot;
      }
    } else if (!currentKnowledgeBase) {
      const bootstrapSelection = await resolveBootstrapKnowledgeBaseSelection(
        sortedKnowledgeBases,
        ctx.kbSnapshotRepository,
        ctx.deployRepository,
      );
      currentKnowledgeBase = bootstrapSelection.knowledgeBase;
      currentKbSnapshot = bootstrapSelection.snapshot;
    }

    const { snapshots: kbSnapshots } =
      await resolveKnowledgeBaseSnapshotSelection({
        knowledgeBase: currentKnowledgeBase,
        kbSnapshotRepository: ctx.kbSnapshotRepository,
        deployLogRepository: ctx.deployRepository,
      });
    const visibleKbSnapshots = kbSnapshots.filter(
      (kbSnapshot) =>
        kbSnapshot.status === 'active' ||
        kbSnapshot.id === currentKbSnapshot?.id,
    );
    const currentKbSnapshotId = currentKbSnapshot?.id;
    const mergedKbSnapshots = currentKbSnapshot
      ? [
          ...visibleKbSnapshots,
          ...(!visibleKbSnapshots.some(
            (kbSnapshot) => kbSnapshot.id === currentKbSnapshotId,
          )
            ? [currentKbSnapshot]
            : []),
        ]
      : visibleKbSnapshots;
    const sortedKbSnapshots = sortByStringField(
      mergedKbSnapshots,
      'displayName',
    );

    if (!currentKbSnapshot && currentKnowledgeBase?.defaultKbSnapshotId) {
      currentKbSnapshot =
        mergedKbSnapshots.find(
          (kbSnapshot) =>
            kbSnapshot.id === currentKnowledgeBase?.defaultKbSnapshotId,
        ) ||
        (await ctx.kbSnapshotRepository.findOneBy({
          id: currentKnowledgeBase.defaultKbSnapshotId,
        })) ||
        null;
    }

    if (!currentKbSnapshot) {
      currentKbSnapshot = sortedKbSnapshots[0] || null;
    }

    const mergedSortedKbSnapshots = currentKbSnapshot
      ? sortByStringField(
          [
            ...sortedKbSnapshots,
            ...(!sortedKbSnapshots.some(
              (kbSnapshot) => kbSnapshot.id === currentKbSnapshot?.id,
            )
              ? [currentKbSnapshot]
              : []),
          ],
          'displayName',
        )
      : sortedKbSnapshots;

    const result = {
      currentWorkspace: toWorkspaceView(currentWorkspace),
      workspaces: sortedWorkspaces.map(toWorkspaceView),
      currentKnowledgeBase: toKnowledgeBaseView(
        currentKnowledgeBase,
        currentKnowledgeBase?.id
          ? knowledgeBaseAssetCountMap.get(currentKnowledgeBase.id)
          : undefined,
      ),
      currentKbSnapshot: toKBSnapshotView(currentKbSnapshot),
      knowledgeBases: sortedKnowledgeBases.map((knowledgeBase) =>
        toKnowledgeBaseView(
          knowledgeBase,
          knowledgeBaseAssetCountMap.get(knowledgeBase.id),
        ),
      ),
      kbSnapshots: mergedSortedKbSnapshots.map(toKBSnapshotView),
    };
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'workspace.read',
      resource: workspaceResource,
      result: 'allowed',
      payloadJson: {
        operation: 'get_runtime_selector_state',
      },
    });
    return result;
  };
}
