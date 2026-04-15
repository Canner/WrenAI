import { NextApiRequest } from 'next';
import { ActorClaims, IAuthService } from '@server/services/authService';
import { IAutomationService } from '@server/services/automationService';
import {
  AuthorizationActor,
  buildAuthorizationActorFromValidatedSession,
} from '@server/authz';

const SESSION_COOKIE_NAMES = [
  'wren_session',
  'wren_session_token',
  'session_token',
];

const coerceHeaderValue = (
  value: string | string[] | undefined,
): string | null => {
  if (Array.isArray(value)) {
    return value[0] || null;
  }

  return value || null;
};

const parseCookieHeader = (
  cookieHeader: string | string[] | undefined,
): Record<string, string> => {
  const rawCookie = coerceHeaderValue(cookieHeader);
  if (!rawCookie) {
    return {};
  }

  return rawCookie
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((cookies, segment) => {
      const separatorIndex = segment.indexOf('=');
      if (separatorIndex <= 0) {
        return cookies;
      }

      const key = decodeURIComponent(segment.slice(0, separatorIndex).trim());
      const value = decodeURIComponent(
        segment.slice(separatorIndex + 1).trim(),
      );
      cookies[key] = value;
      return cookies;
    }, {});
};

export interface ResolvedRequestActor {
  sessionToken: string | null;
  actorClaims: ActorClaims | null;
  userId: string | null;
  workspaceId: string | null;
  principalType?: string | null;
  serviceAccountId?: string | null;
  apiTokenId?: string | null;
  isPlatformAdmin?: boolean;
  authorizationActor?: AuthorizationActor | null;
  sessionId?: string | null;
}

export const getSessionTokenFromRequest = (
  req: NextApiRequest,
): string | null => {
  const authorizationHeader = coerceHeaderValue(req.headers.authorization);
  if (authorizationHeader?.toLowerCase().startsWith('bearer ')) {
    return authorizationHeader.slice(7).trim();
  }

  const sessionHeader =
    coerceHeaderValue(req.headers['x-wren-session-token']) ||
    coerceHeaderValue(req.headers['x-session-token']);
  if (sessionHeader) {
    return sessionHeader;
  }

  const cookies = parseCookieHeader(req.headers.cookie);
  for (const cookieName of SESSION_COOKIE_NAMES) {
    if (cookies[cookieName]) {
      return cookies[cookieName];
    }
  }

  return null;
};

export const resolveRequestActor = async ({
  req,
  authService,
  automationService,
  workspaceId,
}: {
  req: NextApiRequest;
  authService: IAuthService;
  automationService?: IAutomationService;
  workspaceId?: string | null;
}): Promise<ResolvedRequestActor> => {
  const sessionToken = getSessionTokenFromRequest(req);
  if (!sessionToken) {
    return {
      sessionToken: null,
      actorClaims: null,
      userId: null,
      workspaceId: workspaceId || null,
      principalType: null,
      serviceAccountId: null,
      apiTokenId: null,
      isPlatformAdmin: false,
      authorizationActor: null,
      sessionId: null,
    };
  }

  const validatedSession = await authService.validateSession(
    sessionToken,
    workspaceId || undefined,
  );

  if (!validatedSession) {
    const authorizationHeader = coerceHeaderValue(req.headers.authorization);
    const isBearerToken = authorizationHeader
      ?.toLowerCase()
      .startsWith('bearer ');
    if (isBearerToken && automationService) {
      const validatedApiToken = await automationService.validateApiToken(
        sessionToken,
        workspaceId || undefined,
      );
      if (validatedApiToken) {
        return {
          sessionToken,
          actorClaims: null,
          userId: null,
          workspaceId: validatedApiToken.workspaceId,
          principalType: 'service_account',
          serviceAccountId: validatedApiToken.serviceAccount.id,
          apiTokenId: validatedApiToken.token.id,
          isPlatformAdmin: false,
          authorizationActor: validatedApiToken.authorizationActor,
          sessionId: null,
        };
      }
    }

    throw new Error('Invalid or expired session');
  }

  return {
    sessionToken,
    actorClaims: validatedSession.actorClaims,
    userId: validatedSession.user.id,
    workspaceId: validatedSession.workspace.id,
    principalType: 'user',
    serviceAccountId: null,
    apiTokenId: null,
    isPlatformAdmin: Boolean(validatedSession.actorClaims.isPlatformAdmin),
    authorizationActor:
      buildAuthorizationActorFromValidatedSession(validatedSession),
    sessionId: validatedSession.session.id,
  };
};
