import { IContext } from '../types';
import { KBSnapshot, KnowledgeBase, Workspace } from '../repositories';

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
      }
    : null;

const toKnowledgeBaseView = (knowledgeBase: KnowledgeBase | null | undefined) =>
  knowledgeBase
    ? {
        id: knowledgeBase.id,
        slug: knowledgeBase.slug,
        name: knowledgeBase.name,
        defaultKbSnapshotId: knowledgeBase.defaultKbSnapshotId || null,
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

export class RuntimeSelectorResolver {
  getRuntimeSelectorState = async (
    _parent: any,
    _args: any,
    ctx: IContext,
  ) => {
    const runtimeScope = ctx.runtimeScope;
    const currentProject = runtimeScope?.project || null;
    const currentWorkspace = runtimeScope?.workspace || null;
    const currentKnowledgeBase = runtimeScope?.knowledgeBase || null;
    const currentKbSnapshot = runtimeScope?.kbSnapshot || null;

    if (!currentProject) {
      return null;
    }

    if (!currentWorkspace) {
      return {
        currentProjectId: currentProject.id,
        currentWorkspace: null,
        currentKnowledgeBase: null,
        currentKbSnapshot: null,
        knowledgeBases: [],
        kbSnapshots: [],
      };
    }

    const workspaceKnowledgeBases = await ctx.knowledgeBaseRepository.findAllBy({
      workspaceId: currentWorkspace.id,
    });
    const visibleKnowledgeBases = workspaceKnowledgeBases.filter(
      (knowledgeBase) =>
        !knowledgeBase.archivedAt ||
        knowledgeBase.id === currentKnowledgeBase?.id,
    );
    const mergedKnowledgeBases = currentKnowledgeBase
      ? [
          ...visibleKnowledgeBases,
          ...(!visibleKnowledgeBases.some(
            (knowledgeBase) => knowledgeBase.id === currentKnowledgeBase.id,
          )
            ? [currentKnowledgeBase]
            : []),
        ]
      : visibleKnowledgeBases;

    const kbSnapshots = currentKnowledgeBase
      ? await ctx.kbSnapshotRepository.findAllBy({
          knowledgeBaseId: currentKnowledgeBase.id,
        })
      : [];
    const visibleKbSnapshots = kbSnapshots.filter(
      (kbSnapshot) =>
        kbSnapshot.status === 'active' ||
        kbSnapshot.id === currentKbSnapshot?.id,
    );
    const mergedKbSnapshots = currentKbSnapshot
      ? [
          ...visibleKbSnapshots,
          ...(!visibleKbSnapshots.some(
            (kbSnapshot) => kbSnapshot.id === currentKbSnapshot.id,
          )
            ? [currentKbSnapshot]
            : []),
        ]
      : visibleKbSnapshots;

    return {
      currentProjectId: currentProject.id,
      currentWorkspace: toWorkspaceView(currentWorkspace),
      currentKnowledgeBase: toKnowledgeBaseView(currentKnowledgeBase),
      currentKbSnapshot: toKBSnapshotView(currentKbSnapshot),
      knowledgeBases: sortByStringField(mergedKnowledgeBases, 'name').map(
        toKnowledgeBaseView,
      ),
      kbSnapshots: sortByStringField(mergedKbSnapshots, 'displayName').map(
        toKBSnapshotView,
      ),
    };
  };
}
