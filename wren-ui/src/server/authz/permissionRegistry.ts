export const AUTHORIZATION_ACTIONS = {
  'platform.user.read': {
    description: 'Read the platform user directory',
    scope: 'platform',
  },
  'platform.user.create': {
    description: 'Create platform users',
    scope: 'platform',
  },
  'platform.user.update': {
    description: 'Update platform user profile fields',
    scope: 'platform',
  },
  'platform.user.role.assign': {
    description: 'Assign platform roles to users',
    scope: 'platform',
  },
  'platform.user.workspace.assign': {
    description: 'Assign users to workspaces from the platform console',
    scope: 'platform',
  },
  'platform.role.read': {
    description: 'Read platform role catalog and permission assignments',
    scope: 'platform',
  },
  'platform.role.create': {
    description: 'Create platform roles',
    scope: 'platform',
  },
  'platform.role.update': {
    description: 'Update platform roles',
    scope: 'platform',
  },
  'platform.role.delete': {
    description: 'Delete platform roles',
    scope: 'platform',
  },
  'platform.workspace.read': {
    description: 'Read workspace governance data from the platform console',
    scope: 'platform',
  },
  'workspace.create': {
    description: 'Create a new workspace',
    scope: 'platform',
  },
  'platform.workspace.member.manage': {
    description: 'Manage workspace members from the platform console',
    scope: 'platform',
  },
  'workspace.read': {
    description: 'Read workspace metadata',
    scope: 'workspace',
  },
  'workspace.default.set': {
    description: 'Set personal default workspace',
    scope: 'workspace',
  },
  'workspace.member.invite': {
    description: 'Invite a workspace member',
    scope: 'workspace',
  },
  'workspace.member.approve': {
    description: 'Approve a workspace join request',
    scope: 'workspace',
  },
  'workspace.member.reject': {
    description: 'Reject a workspace join request',
    scope: 'workspace',
  },
  'workspace.member.status.update': {
    description: 'Update a workspace member status',
    scope: 'workspace',
  },
  'workspace.member.remove': {
    description: 'Remove a workspace member',
    scope: 'workspace',
  },
  'workspace.member.role.update': {
    description: 'Change a workspace member role',
    scope: 'workspace',
  },
  'workspace.schedule.manage': {
    description: 'Manage workspace schedules',
    scope: 'workspace',
  },
  'dashboard.schedule.manage': {
    description: 'Manage dashboard schedules',
    scope: 'workspace',
  },
  'knowledge_base.create': {
    description: 'Create a knowledge base',
    scope: 'workspace',
  },
  'knowledge_base.read': {
    description: 'Read a knowledge base',
    scope: 'workspace',
  },
  'knowledge_base.update': {
    description: 'Update a knowledge base',
    scope: 'workspace',
  },
  'knowledge_base.archive': {
    description: 'Archive or restore a knowledge base',
    scope: 'workspace',
  },
  'connector.create': {
    description: 'Create a connector',
    scope: 'workspace',
  },
  'connector.read': {
    description: 'Read connector details',
    scope: 'workspace',
  },
  'connector.update': {
    description: 'Update a connector',
    scope: 'workspace',
  },
  'connector.delete': {
    description: 'Delete a connector',
    scope: 'workspace',
  },
  'connector.rotate_secret': {
    description: 'Rotate or replace connector secrets',
    scope: 'workspace',
  },
  'skill.create': {
    description: 'Create a skill',
    scope: 'workspace',
  },
  'skill.read': {
    description: 'Read skill details',
    scope: 'workspace',
  },
  'skill.update': {
    description: 'Update a skill',
    scope: 'workspace',
  },
  'skill.delete': {
    description: 'Delete a skill',
    scope: 'workspace',
  },
  'secret.reencrypt': {
    description: 'Re-encrypt workspace secrets',
    scope: 'workspace',
  },
  'service_account.read': {
    description: 'Read service account details',
    scope: 'workspace',
  },
  'service_account.create': {
    description: 'Create a service account',
    scope: 'workspace',
  },
  'service_account.update': {
    description: 'Update a service account',
    scope: 'workspace',
  },
  'service_account.delete': {
    description: 'Delete a service account',
    scope: 'workspace',
  },
  'api_token.read': {
    description: 'Read API token metadata',
    scope: 'workspace',
  },
  'api_token.create': {
    description: 'Create an API token',
    scope: 'workspace',
  },
  'api_token.revoke': {
    description: 'Revoke an API token',
    scope: 'workspace',
  },
  'identity_provider.read': {
    description: 'Read identity provider settings',
    scope: 'workspace',
  },
  'identity_provider.manage': {
    description: 'Manage identity provider settings',
    scope: 'workspace',
  },
  'access_review.read': {
    description: 'Read access review records',
    scope: 'workspace',
  },
  'access_review.manage': {
    description: 'Manage access review records',
    scope: 'workspace',
  },
  'group.read': {
    description: 'Read directory group bindings',
    scope: 'workspace',
  },
  'group.manage': {
    description: 'Manage directory groups and role bindings',
    scope: 'workspace',
  },
  'audit.read': {
    description: 'Read workspace audit events',
    scope: 'workspace',
  },
  'role.read': {
    description: 'Read workspace role catalog and bindings',
    scope: 'workspace',
  },
  'role.manage': {
    description: 'Manage custom workspace roles and bindings',
    scope: 'workspace',
  },
  'break_glass.manage': {
    description: 'Manage emergency break-glass grants',
    scope: 'platform',
  },
  'impersonation.start': {
    description: 'Start an audited impersonation session',
    scope: 'platform',
  },
  'platform.audit.read': {
    description: 'Read platform audit logs',
    scope: 'platform',
  },
  'platform.diagnostics.read': {
    description: 'Read platform diagnostics data',
    scope: 'platform',
  },
  'platform.system_task.read': {
    description: 'Read platform system task status',
    scope: 'platform',
  },
  'platform.system_task.manage': {
    description: 'Manage platform system tasks',
    scope: 'platform',
  },
} as const;

export type AuthorizationAction = keyof typeof AUTHORIZATION_ACTIONS;

export type AuthorizationActionMeta =
  (typeof AUTHORIZATION_ACTIONS)[AuthorizationAction];

export const getAuthorizationActionMeta = (
  action: AuthorizationAction,
): AuthorizationActionMeta => AUTHORIZATION_ACTIONS[action];

export const isAuthorizationAction = (
  value: string,
): value is AuthorizationAction => value in AUTHORIZATION_ACTIONS;

const CUSTOM_ROLE_BLOCKLIST = new Set<AuthorizationAction>([
  'workspace.create',
  'workspace.member.invite',
  'workspace.member.approve',
  'workspace.member.reject',
  'workspace.member.status.update',
  'workspace.member.remove',
  'workspace.member.role.update',
  'identity_provider.manage',
  'access_review.manage',
  'break_glass.manage',
  'impersonation.start',
  'role.read',
  'role.manage',
  'audit.read',
]);

export const getWorkspaceAuthorizationActions = () =>
  (Object.keys(AUTHORIZATION_ACTIONS) as AuthorizationAction[]).filter(
    (action) => AUTHORIZATION_ACTIONS[action].scope === 'workspace',
  );

export const getCustomRoleAssignableActions = () =>
  getWorkspaceAuthorizationActions().filter(
    (action) => !CUSTOM_ROLE_BLOCKLIST.has(action),
  );
