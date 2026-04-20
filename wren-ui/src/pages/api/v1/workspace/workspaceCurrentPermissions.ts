import { AuthorizationAction, authorize } from '@server/authz';

export const buildWorkspacePermissionActions = ({
  actor,
  workspace,
  user,
}: {
  actor: any;
  workspace: any;
  user: { id: string; defaultWorkspaceId?: string | null };
}) => {
  const evaluateAction = (
    action: AuthorizationAction,
    resource: Parameters<typeof authorize>[0]['resource'],
  ) =>
    authorize({
      actor,
      action,
      resource,
    }).allowed;

  const workspaceResource = {
    resourceType: 'workspace',
    resourceId: workspace.id,
    workspaceId: workspace.id,
    attributes: {
      workspaceKind: workspace.kind || null,
    },
  };

  const canManageMembers = evaluateAction(
    'workspace.member.status.update',
    workspaceResource,
  );
  const canInviteMembers = evaluateAction(
    'workspace.member.invite',
    workspaceResource,
  );
  const canApproveMembers = evaluateAction(
    'workspace.member.approve',
    workspaceResource,
  );
  const canManageSchedules = evaluateAction(
    'workspace.schedule.manage',
    workspaceResource,
  );
  const canCreateWorkspace = evaluateAction('workspace.create', {
    resourceType: 'workspace',
    resourceId: 'new',
    workspaceId: actor.workspaceId || workspace.id,
  });

  const actions = {
    'workspace.create': canCreateWorkspace,
    'workspace.default.set': evaluateAction('workspace.default.set', {
      resourceType: 'workspace',
      resourceId: user.defaultWorkspaceId || 'self',
      ownerUserId: user.id,
    }),
    'workspace.member.invite': canInviteMembers,
    'workspace.member.approve': canApproveMembers,
    'workspace.member.status.update': canManageMembers,
    'workspace.member.role.update': evaluateAction(
      'workspace.member.role.update',
      workspaceResource,
    ),
    'workspace.member.remove': evaluateAction(
      'workspace.member.remove',
      workspaceResource,
    ),
    'workspace.schedule.manage': canManageSchedules,
    'knowledge_base.create': evaluateAction('knowledge_base.create', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'connector.create': evaluateAction('connector.create', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'skill.create': evaluateAction('skill.create', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
    }),
    'secret.reencrypt': evaluateAction('secret.reencrypt', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
    }),
    'service_account.read': evaluateAction('service_account.read', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'service_account.create': evaluateAction('service_account.create', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'service_account.update': evaluateAction('service_account.update', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'service_account.delete': evaluateAction('service_account.delete', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'api_token.read': evaluateAction('api_token.read', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'api_token.create': evaluateAction('api_token.create', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'api_token.revoke': evaluateAction('api_token.revoke', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'identity_provider.read': evaluateAction('identity_provider.read', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'identity_provider.manage': evaluateAction('identity_provider.manage', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'access_review.read': evaluateAction('access_review.read', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'access_review.manage': evaluateAction('access_review.manage', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'group.read': evaluateAction('group.read', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'group.manage': evaluateAction('group.manage', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'audit.read': evaluateAction('audit.read', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'role.read': evaluateAction('role.read', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'role.manage': evaluateAction('role.manage', {
      resourceType: 'workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      attributes: {
        workspaceKind: workspace.kind || null,
      },
    }),
    'break_glass.manage': evaluateAction('break_glass.manage', {
      resourceType: 'workspace',
      resourceId: workspace.id,
    }),
    'impersonation.start': evaluateAction('impersonation.start', {
      resourceType: 'workspace',
      resourceId: workspace.id,
    }),
  };

  return {
    canManageMembers,
    canInviteMembers,
    canApproveMembers,
    canManageSchedules,
    canCreateWorkspace,
    actions,
  };
};
