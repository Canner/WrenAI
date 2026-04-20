export const PLATFORM_ADMIN_ROLE_NAME = 'platform_admin';
export const PLATFORM_SCOPE_ID = '';

export const LEGACY_WORKSPACE_ROLE_KEYS = ['owner', 'admin', 'member'] as const;

export type LegacyWorkspaceRoleKey =
  (typeof LEGACY_WORKSPACE_ROLE_KEYS)[number];

export const STRUCTURED_WORKSPACE_ROLE_BY_LEGACY: Record<
  LegacyWorkspaceRoleKey,
  string
> = {
  owner: 'workspace_owner',
  admin: 'workspace_admin',
  member: 'workspace_viewer',
};

const LEGACY_WORKSPACE_ROLE_BY_STRUCTURED = Object.entries(
  STRUCTURED_WORKSPACE_ROLE_BY_LEGACY,
).reduce<Record<string, LegacyWorkspaceRoleKey>>((acc, [legacyRole, role]) => {
  acc[role] = legacyRole as LegacyWorkspaceRoleKey;
  return acc;
}, {});

const LEGACY_WORKSPACE_ROLE_ALIASES: Record<string, LegacyWorkspaceRoleKey> = {
  viewer: 'member',
};

export type AuthorizationRoleSource = 'legacy' | 'role_binding';

export const normalizeRoleKey = (roleKey?: string | null) =>
  String(roleKey || '')
    .trim()
    .toLowerCase();

export const toLegacyWorkspaceRoleKey = (
  roleKey?: string | null,
): LegacyWorkspaceRoleKey | null => {
  const normalizedRoleKey = normalizeRoleKey(roleKey);
  if (!normalizedRoleKey) {
    return null;
  }

  if (normalizedRoleKey in LEGACY_WORKSPACE_ROLE_BY_STRUCTURED) {
    return LEGACY_WORKSPACE_ROLE_BY_STRUCTURED[normalizedRoleKey];
  }

  if (normalizedRoleKey in LEGACY_WORKSPACE_ROLE_ALIASES) {
    return LEGACY_WORKSPACE_ROLE_ALIASES[normalizedRoleKey];
  }

  if (
    (LEGACY_WORKSPACE_ROLE_KEYS as readonly string[]).includes(
      normalizedRoleKey,
    )
  ) {
    return normalizedRoleKey as LegacyWorkspaceRoleKey;
  }

  return null;
};

export const toLegacyWorkspaceRoleKeys = (
  roleKeys: Array<string | null | undefined>,
) =>
  Array.from(
    new Set(
      roleKeys
        .map((roleKey) => toLegacyWorkspaceRoleKey(roleKey))
        .filter(Boolean),
    ),
  ) as LegacyWorkspaceRoleKey[];

export const toStructuredWorkspaceRoleName = (
  roleKey?: string | null,
): string | null => {
  const normalizedLegacyRole = toLegacyWorkspaceRoleKey(roleKey);
  if (!normalizedLegacyRole) {
    return null;
  }

  return STRUCTURED_WORKSPACE_ROLE_BY_LEGACY[normalizedLegacyRole];
};

export const isPlatformAdminRoleName = (roleKey?: string | null) =>
  normalizeRoleKey(roleKey) === PLATFORM_ADMIN_ROLE_NAME;
