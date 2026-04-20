import { useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import useRestRequest from './useRestRequest';

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

export const buildAuthSessionUrl = (workspaceId: string | undefined) => {
  const searchParams = new URLSearchParams();
  if (workspaceId) {
    searchParams.set('workspaceId', workspaceId);
  }

  return `/api/auth/session${
    searchParams.toString() ? `?${searchParams.toString()}` : ''
  }`;
};

export const buildAuthSessionRequestKey = ({
  includeWorkspaceQuery,
  routerReady,
  workspaceId,
}: {
  includeWorkspaceQuery: boolean;
  routerReady: boolean;
  workspaceId?: string;
}) =>
  routerReady ? buildSessionCacheKey(workspaceId, includeWorkspaceQuery) : null;

const AUTH_SESSION_CACHE_TTL_MS = 120_000;
const AUTH_SESSION_STORAGE_PREFIX = 'wren.authSession:';
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

const getAuthSessionStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage;
};

const getAuthSessionStorageKey = (sessionCacheKey: string) =>
  `${AUTH_SESSION_STORAGE_PREFIX}${sessionCacheKey}`;

const getAuthSessionStorageKeys = (storage: Storage, prefix: string) => {
  const keys: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) {
      keys.push(key);
    }
  }

  return keys;
};

const readStoredAuthSession = (sessionCacheKey: string) => {
  const storage = getAuthSessionStorage();
  if (!storage) {
    return null;
  }

  try {
    const rawValue = storage.getItem(getAuthSessionStorageKey(sessionCacheKey));
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as {
      payload: AuthSessionPayload;
      updatedAt: number;
    } | null;
    if (!parsed || typeof parsed.updatedAt !== 'number' || !parsed.payload) {
      storage.removeItem(getAuthSessionStorageKey(sessionCacheKey));
      return null;
    }

    return parsed;
  } catch (_error) {
    return null;
  }
};

const writeStoredAuthSession = (
  sessionCacheKey: string,
  entry: { payload: AuthSessionPayload; updatedAt: number },
) => {
  const storage = getAuthSessionStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      getAuthSessionStorageKey(sessionCacheKey),
      JSON.stringify(entry),
    );
  } catch (_error) {
    // ignore sessionStorage write failures
  }
};

const getFreshCachedAuthSession = (sessionCacheKey: string) => {
  const inMemorySession = authSessionCache.get(sessionCacheKey) || null;
  const cachedSession =
    inMemorySession || readStoredAuthSession(sessionCacheKey);
  if (!cachedSession) {
    return null;
  }

  if (Date.now() - cachedSession.updatedAt > AUTH_SESSION_CACHE_TTL_MS) {
    authSessionCache.delete(sessionCacheKey);
    getAuthSessionStorage()?.removeItem(
      getAuthSessionStorageKey(sessionCacheKey),
    );
    return null;
  }

  if (!inMemorySession) {
    authSessionCache.set(sessionCacheKey, cachedSession);
  }

  return cachedSession.payload;
};

export const clearAuthSessionCache = () => {
  authSessionCache.clear();
  authSessionRequestCache.clear();

  const storage = getAuthSessionStorage();
  if (!storage) {
    return;
  }

  try {
    const keysToRemove = getAuthSessionStorageKeys(
      storage,
      AUTH_SESSION_STORAGE_PREFIX,
    );
    keysToRemove.forEach((key) => storage.removeItem(key));
  } catch (_error) {
    // ignore sessionStorage cleanup failures
  }
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

      const entry = {
        payload,
        updatedAt: Date.now(),
      };
      authSessionCache.set(sessionCacheKey, entry);
      writeStoredAuthSession(sessionCacheKey, entry);
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
    () =>
      buildAuthSessionRequestKey({
        includeWorkspaceQuery,
        routerReady: router.isReady,
        workspaceId,
      }),
    [includeWorkspaceQuery, router.isReady, workspaceId],
  );
  const cachedSession = useMemo(
    () => (sessionCacheKey ? getFreshCachedAuthSession(sessionCacheKey) : null),
    [sessionCacheKey],
  );
  const requestState = useRestRequest<AuthSessionPayload | null>({
    enabled: Boolean(sessionCacheKey),
    auto: Boolean(sessionCacheKey),
    initialData: cachedSession,
    requestKey: sessionCacheKey,
    request: async () =>
      loadAuthSessionPayload({
        sessionCacheKey: sessionCacheKey as string,
        workspaceId,
      }),
    resetDataOnDisable: false,
  });
  const { data, loading, error, refetch, setData } = requestState;

  useEffect(() => {
    setData(cachedSession);
  }, [cachedSession, setData]);

  const refresh = useCallback(async () => {
    if (!sessionCacheKey) {
      return null;
    }

    try {
      return await refetch();
    } catch (_error) {
      return null;
    }
  }, [refetch, sessionCacheKey]);

  const resolvedData = useMemo<AuthSessionPayload | null>(() => {
    if (data) {
      return data;
    }

    if (error) {
      return { authenticated: false };
    }

    return null;
  }, [data, error]);

  return {
    loading,
    authenticated: Boolean(resolvedData?.authenticated),
    data: resolvedData,
    error: error?.message || null,
    refresh,
  };
}
