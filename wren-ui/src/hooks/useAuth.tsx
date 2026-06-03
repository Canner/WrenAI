import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/router';
import PageLoading from '@/components/PageLoading';
import { Path } from '@/utils/enum';

type RoleName = 'Admin' | 'Manager' | 'Analyst' | 'Viewer';

type AuthState = {
  loading: boolean;
  authenticated: boolean;
  bootstrapRequired: boolean;
  user?: any;
  member?: any;
  organization?: any;
  role?: { name: RoleName };
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  canAccessPath: (path: string) => boolean;
};

const AuthContext = createContext<AuthState>({
  loading: true,
  authenticated: false,
  bootstrapRequired: false,
  refresh: async () => undefined,
  logout: async () => undefined,
  canAccessPath: () => true,
});

const PUBLIC_PATHS = [Path.Login, Path.AcceptInvitation, Path.Onboarding];

const ROLE_PATHS: Record<RoleName, string[]> = {
  Admin: [
    Path.Home,
    Path.Modeling,
    Path.Knowledge,
    Path.APIManagement,
    Path.Administration,
  ],
  Manager: [Path.Home, Path.Modeling, Path.Knowledge, Path.APIManagement],
  Analyst: [Path.Home, Path.Knowledge],
  Viewer: [Path.Home],
};

const isPublicPath = (pathname: string) =>
  PUBLIC_PATHS.some((path) => pathname.startsWith(path));

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<
    Omit<AuthState, 'refresh' | 'logout' | 'canAccessPath'>
  >({
    loading: true,
    authenticated: false,
    bootstrapRequired: false,
  });

  const refresh = useCallback(async () => {
    const [statusResponse, meResponse] = await Promise.all([
      fetch('/api/auth/status'),
      fetch('/api/auth/me'),
    ]);
    const status = await statusResponse.json();
    const me = meResponse.ok ? await meResponse.json() : null;
    setState({
      loading: false,
      bootstrapRequired: Boolean(status.required),
      authenticated: Boolean(me?.authenticated),
      user: me?.user,
      member: me?.member,
      organization: me?.organization,
      role: me?.role,
    });
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const canAccessPath = useCallback(
    (path: string) => {
      if (isPublicPath(path)) return true;
      if (!state.authenticated) return false;
      const roleName = state.role?.name;
      if (!roleName) return false;
      return ROLE_PATHS[roleName].some((allowed) => path.startsWith(allowed));
    },
    [state.authenticated, state.role?.name],
  );

  const value = useMemo(
    () => ({ ...state, refresh, logout, canAccessPath }),
    [state, refresh, logout, canAccessPath],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const AuthGate = ({ children }: { children: ReactNode }) => {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.loading) return;
    if (isPublicPath(router.pathname)) return;
    if (!auth.authenticated) {
      void router.replace(Path.Login);
      return;
    }
    if (!auth.canAccessPath(router.pathname)) {
      void router.replace(Path.Home);
    }
  }, [auth, router]);

  if (auth.loading) return <PageLoading />;
  if (!isPublicPath(router.pathname) && !auth.authenticated) {
    return <PageLoading />;
  }
  return <>{children}</>;
};

export const useAuth = () => useContext(AuthContext);
