export const PERMISSION_ROLE_LABELS: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
};

export const PERMISSION_PRINCIPAL_TYPE_OPTIONS = [
  { label: '用户', value: 'user' },
  { label: '目录组', value: 'group' },
  { label: '服务账号', value: 'service_account' },
] satisfies Array<{
  label: string;
  value: 'user' | 'group' | 'service_account';
}>;

export const BREAK_GLASS_ROLE_OPTIONS = [
  { label: '所有者', value: 'owner' },
  { label: '管理员', value: 'admin' },
  { label: '成员', value: 'member' },
] satisfies Array<{ label: string; value: 'owner' | 'admin' | 'member' }>;

export const BREAK_GLASS_DURATION_OPTIONS = [
  { label: '15 分钟', value: '15' },
  { label: '30 分钟', value: '30' },
  { label: '60 分钟', value: '60' },
  { label: '240 分钟', value: '240' },
] satisfies Array<{ label: string; value: string }>;

export const countActiveBreakGlassGrants = (
  grants: Array<{ revokedAt?: string | null; status?: string | null }> = [],
) =>
  grants.filter((grant) => !grant.revokedAt && grant.status === 'active')
    .length;

export const getAccessReviewStatusColor = (status?: string | null) =>
  status === 'completed' ? 'green' : 'gold';

export const getAccessReviewDecisionColor = (decision?: string | null) =>
  decision === 'remove' ? 'red' : decision === 'keep' ? 'green' : 'gold';

export const normalizeWorkspaceRoleNameInput = (value?: string | null) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

export const buildCopiedWorkspaceRoleName = ({
  sourceName,
  existingNames,
}: {
  sourceName?: string | null;
  existingNames: Iterable<string>;
}) => {
  const existing = new Set(
    Array.from(existingNames).map((name) => String(name || '').trim()),
  );
  const baseName =
    normalizeWorkspaceRoleNameInput(sourceName) || 'workspace_custom_role';
  let candidate = `${baseName}_copy`;
  let sequence = 2;
  while (existing.has(candidate)) {
    candidate = `${baseName}_copy_${sequence}`;
    sequence += 1;
  }
  return candidate;
};

export const summarizePermissionDiff = (
  baselinePermissionNames: string[] = [],
  draftPermissionNames: string[] = [],
) => {
  const baselineSet = new Set(baselinePermissionNames);
  const draftSet = new Set(draftPermissionNames);

  return {
    added: Array.from(draftSet).filter((name) => !baselineSet.has(name)).length,
    removed: Array.from(baselineSet).filter((name) => !draftSet.has(name))
      .length,
  };
};
