import { normalizeRoleKey, toLegacyWorkspaceRoleKey } from './roleMapping';

const normalizeWorkspaceRoleKey = (roleKey?: string | null) =>
  toLegacyWorkspaceRoleKey(roleKey) || normalizeRoleKey(roleKey);

export const isWorkspaceManagerRole = (roleKey?: string | null) =>
  ['owner', 'admin'].includes(normalizeWorkspaceRoleKey(roleKey));

export const hasWorkspaceWriteRole = (roleKey?: string | null) =>
  isWorkspaceManagerRole(roleKey);

export const canManageWorkspaceMemberRole = ({
  actorRoleKey,
  targetRoleKey: _targetRoleKey,
  nextRoleKey: _nextRoleKey,
}: {
  actorRoleKey?: string | null;
  targetRoleKey?: string | null;
  nextRoleKey?: string | null;
}) => {
  const actorRole = normalizeWorkspaceRoleKey(actorRoleKey);

  if (!isWorkspaceManagerRole(actorRole)) {
    return false;
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
