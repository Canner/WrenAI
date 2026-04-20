import type { AuthorizationAction } from './permissionRegistry';
import type { AuthorizationActor } from './authorizationActor';

export interface AuthorizationResource {
  resourceType: string;
  resourceId?: string | number | null;
  workspaceId?: string | null;
  ownerUserId?: string | null;
  attributes?: {
    workspaceKind?: string | null;
    knowledgeBaseKind?: string | null;
    targetRoleKey?: string | null;
    nextRoleKey?: string | null;
    targetUserId?: string | null;
  } & Record<string, any>;
}

export interface AuthorizationContext {
  requestId?: string | null;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  runtimeScope?: Record<string, any> | null;
}

export interface AuthorizationDecision {
  allowed: boolean;
  action: AuthorizationAction;
  actor: AuthorizationActor | null;
  resource: AuthorizationResource | null;
  reason?: string;
  statusCode: number;
}

export class AuthorizationError extends Error {
  statusCode: number;
  action: AuthorizationAction;

  constructor(action: AuthorizationAction, message: string, statusCode = 403) {
    super(message);
    this.name = 'AuthorizationError';
    this.action = action;
    this.statusCode = statusCode;
  }
}

export const deny = ({
  action,
  actor,
  resource,
  reason,
  statusCode = 403,
}: {
  action: AuthorizationAction;
  actor: AuthorizationActor | null;
  resource: AuthorizationResource | null;
  reason: string;
  statusCode?: number;
}): AuthorizationDecision => ({
  allowed: false,
  action,
  actor,
  resource,
  reason,
  statusCode,
});

export const allow = ({
  action,
  actor,
  resource,
}: {
  action: AuthorizationAction;
  actor: AuthorizationActor;
  resource: AuthorizationResource | null;
}): AuthorizationDecision => ({
  allowed: true,
  action,
  actor,
  resource,
  statusCode: 200,
});
