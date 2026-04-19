import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';

interface AuthSessionUser {
  id: string;
  email: string;
  displayName?: string | null;
  isPlatformAdmin?: boolean;
  defaultWorkspaceId?: string | null;
}

interface AuthSessionWorkspace {
  id: string;
  slug?: string | null;
  name: string;
  kind?: string | null;
}

interface AuthSessionMembership {
  id: string;
  roleKey: string;
}

interface AuthSessionInfo {
  id: string;
  expiresAt: string;
  lastSeenAt?: string | null;
  impersonatorUserId?: string | null;
  impersonationReason?: string | null;
}

interface AuthSessionAuthorizationActor {
  principalType: string;
  principalId: string;
  workspaceId?: string | null;
  workspaceMemberId?: string | null;
  workspaceRoleKeys?: string[];
  permissionScopes?: string[];
  isPlatformAdmin?: boolean;
  platformRoleKeys?: string[];
  grantedActions?: string[];
  workspaceRoleSource?: 'legacy' | 'role_binding';
  platformRoleSource?: 'legacy' | 'role_binding';
}

export interface AuthSessionPayload {
  authenticated: boolean;
  user?: AuthSessionUser;
  workspace?: AuthSessionWorkspace;
  membership?: AuthSessionMembership;
  workspaces?: AuthSessionWorkspace[];
  isPlatformAdmin?: boolean;
  defaultWorkspaceId?: string | null;
  runtimeSelector?: ClientRuntimeScopeSelector;
  session?: AuthSessionInfo;
  impersonation?: {
    active?: boolean;
    canStop?: boolean;
    impersonatorUserId?: string | null;
    reason?: string | null;
  } | null;
  authorization?: {
    actor?: AuthSessionAuthorizationActor | null;
    actions?: Record<string, boolean>;
  } | null;
  error?: string;
}

interface UseAuthSessionOptions {
  includeWorkspaceQuery?: boolean;
}

const getWorkspaceId = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const buildSessionCacheKey = (
  workspaceId: string | undefined,
  includeWorkspaceQuery: boolean,
) =>
  includeWorkspaceQuery ? `workspace:${workspaceId || 'default'}` : 'global';

const buildAuthSessionUrl = (workspaceId: string | undefined) => {
  const searchParams = new URLSearchParams();
  if (workspaceId) {
    searchParams.set('workspaceId', workspaceId);
  }

  return `/api/auth/session${
    searchParams.toString() ? `?${searchParams.toString()}` : ''
  }`;
};

const AUTH_SESSION_CACHE_TTL_MS = 120_000;
// Intentional exception to the generic request primitive:
// auth session needs cross-component TTL caching + in-flight dedupe so every
// shell/status consumer can share one request per scope without extra churn.
const authSessionCache = new Map<
  string,
  { payload: AuthSessionPayload; updatedAt: number }
>();
const authSessionRequestCache = new Map<
  string,
  Promise<AuthSessionPayload | null>
>();

const getFreshCachedAuthSession = (sessionCacheKey: string) => {
  const cachedSession = authSessionCache.get(sessionCacheKey);
  if (!cachedSession) {
    return null;
  }

  if (Date.now() - cachedSession.updatedAt > AUTH_SESSION_CACHE_TTL_MS) {
    authSessionCache.delete(sessionCacheKey);
    return null;
  }

  return cachedSession.payload;
};

export const clearAuthSessionCache = () => {
  authSessionCache.clear();
  authSessionRequestCache.clear();
};

export const loadAuthSessionPayload = async ({
  sessionCacheKey,
  workspaceId,
}: {
  sessionCacheKey: string;
  workspaceId?: string;
}) => {
  const cachedPayload = getFreshCachedAuthSession(sessionCacheKey);
  if (cachedPayload) {
    return cachedPayload;
  }

  const pendingRequest = authSessionRequestCache.get(sessionCacheKey);
  if (pendingRequest) {
    return pendingRequest;
  }

  const request = fetch(buildAuthSessionUrl(workspaceId), {
    credentials: 'include',
  })
    .then(async (response) => {
      const payload = (await response.json()) as AuthSessionPayload;

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load auth session');
      }

      authSessionCache.set(sessionCacheKey, {
        payload,
        updatedAt: Date.now(),
      });
      return payload;
    })
    .finally(() => {
      authSessionRequestCache.delete(sessionCacheKey);
    });

  authSessionRequestCache.set(sessionCacheKey, request);
  return request;
};

export const prefetchAuthSessionPayload = ({
  workspaceId,
  includeWorkspaceQuery = true,
}: {
  workspaceId?: string;
  includeWorkspaceQuery?: boolean;
}) => {
  const sessionCacheKey = buildSessionCacheKey(
    workspaceId,
    includeWorkspaceQuery,
  );

  void loadAuthSessionPayload({
    sessionCacheKey,
    workspaceId: includeWorkspaceQuery ? workspaceId : undefined,
  }).catch(() => null);
};

export default function useAuthSession(options: UseAuthSessionOptions = {}) {
  const { includeWorkspaceQuery = true } = options;
  const router = useRouter();
  const workspaceId = useMemo(
    () =>
      includeWorkspaceQuery
        ? getWorkspaceId(router.query.workspaceId)
        : undefined,
    [includeWorkspaceQuery, router.query.workspaceId],
  );
  const sessionCacheKey = useMemo(
    () => buildSessionCacheKey(workspaceId, includeWorkspaceQuery),
    [includeWorkspaceQuery, workspaceId],
  );
  const cachedSession = useMemo(
    () => getFreshCachedAuthSession(sessionCacheKey),
    [sessionCacheKey],
  );
  const [loading, setLoading] = useState(() => !cachedSession);
  const [data, setData] = useState<AuthSessionPayload | null>(cachedSession);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    if (!router.isReady) {
      return null;
    }

    const cachedPayload = getFreshCachedAuthSession(sessionCacheKey);
    if (cachedPayload) {
      setData(cachedPayload);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const payload = await loadAuthSessionPayload({
        sessionCacheKey,
        workspaceId,
      });
      setData(payload);
      return payload;
    } catch (fetchError: any) {
      const fallbackPayload = { authenticated: false };
      setData(fallbackPayload);
      setError(fetchError?.message || 'Failed to load auth session');
      return null;
    } finally {
      setLoading(false);
    }
  }, [router.isReady, sessionCacheKey, workspaceId]);

  useEffect(() => {
    const nextCachedSession = getFreshCachedAuthSession(sessionCacheKey);
    if (nextCachedSession) {
      setData(nextCachedSession);
      setLoading(false);
      return;
    }

    if (router.isReady) {
      setLoading(true);
    }
  }, [router.isReady, sessionCacheKey]);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    void fetchSession();
  }, [fetchSession, router.isReady]);

  return {
    loading,
    authenticated: Boolean(data?.authenticated),
    data,
    error,
    refresh: fetchSession,
  };
}
