import { normalizeRoleKey, toLegacyWorkspaceRoleKey } from './roleMapping';

const normalizeWorkspaceRoleKey = (roleKey?: string | null) =>
  toLegacyWorkspaceRoleKey(roleKey) || normalizeRoleKey(roleKey);

export const isWorkspaceManagerRole = (roleKey?: string | null) =>
  ['owner', 'admin'].includes(normalizeWorkspaceRoleKey(roleKey));

export const hasWorkspaceWriteRole = (roleKey?: string | null) =>
  isWorkspaceManagerRole(roleKey);

export const canManageWorkspaceMemberRole = ({
  actorRoleKey,
  targetRoleKey,
  nextRoleKey,
}: {
  actorRoleKey?: string | null;
  targetRoleKey?: string | null;
  nextRoleKey?: string | null;
}) => {
  const actorRole = normalizeWorkspaceRoleKey(actorRoleKey);
  const targetRole = normalizeWorkspaceRoleKey(targetRoleKey);
  const nextRole = normalizeWorkspaceRoleKey(nextRoleKey);

  if (!isWorkspaceManagerRole(actorRole)) {
    return false;
  }

  if (actorRole === 'admin') {
    if (targetRole === 'owner') {
      return false;
    }

    if (nextRole === 'owner') {
      return false;
    }
  }

  return true;
};

export const isProtectedWorkspaceMemberAction = ({
  actorUserId,
  targetUserId,
  action,
}: {
  actorUserId?: string | null;
  targetUserId?: string | null;
  action: string;
}) => {
  if (!actorUserId || !targetUserId) {
    return false;
  }

  if (actorUserId !== targetUserId) {
    return false;
  }

  return [
    'workspace.member.remove',
    'workspace.member.role.update',
    'workspace.member.status.update',
  ].includes(action);
};
