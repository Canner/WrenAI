import { ReactNode, useMemo } from 'react';
import { useRouter } from 'next/router';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { Path } from '@/utils/enum';
import { getReferenceDisplayThreadTitle } from '@/utils/referenceDemoKnowledge';
import DolaAppShell from './DolaAppShell';
import {
  PersistentShellProvider,
  usePersistentShellEmbedded,
} from './PersistentShellContext';
import { buildNovaShellNavItems, NovaShellNavKey } from './novaShellNavigation';

const PERSISTENT_CONSOLE_SHELL_PATHS = new Set<string>([
  Path.Home,
  Path.HomeDashboard,
  Path.Thread,
  Path.Knowledge,
]);

export const shouldUsePersistentConsoleShell = (pathname?: string | null) =>
  Boolean(pathname && PERSISTENT_CONSOLE_SHELL_PATHS.has(pathname));

export const shouldKeyRuntimeScopePage = (pathname?: string | null) =>
  !shouldUsePersistentConsoleShell(pathname);

export const resolvePersistentShellActiveNav = (
  pathname?: string | null,
): NovaShellNavKey | undefined => {
  switch (pathname) {
    case Path.Home:
      return 'home';
    case Path.Knowledge:
      return 'knowledge';
    case Path.HomeDashboard:
      return 'dashboard';
    default:
      return undefined;
  }
};

export const resolvePersistentShellActiveHistoryId = ({
  pathname,
  queryId,
}: {
  pathname?: string | null;
  queryId?: string | string[] | null;
}) => {
  if (pathname !== Path.Thread) {
    return null;
  }

  if (Array.isArray(queryId)) {
    return queryId[0] || null;
  }

  return queryId || null;
};

interface Props {
  children: ReactNode;
}

export default function PersistentConsoleShell({ children }: Props) {
  const router = useRouter();
  const embedded = usePersistentShellEmbedded();
  const enabled = !embedded && shouldUsePersistentConsoleShell(router.pathname);
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const homeSidebar = useHomeSidebar({
    deferInitialLoad: false,
    loadOnIntent: false,
  });

  const activeNav = useMemo(
    () => resolvePersistentShellActiveNav(router.pathname),
    [router.pathname],
  );
  const activeHistoryId = useMemo(
    () =>
      resolvePersistentShellActiveHistoryId({
        pathname: router.pathname,
        queryId: router.query.id as string | string[] | undefined,
      }),
    [router.pathname, router.query.id],
  );
  const navItems = useMemo(
    () =>
      buildNovaShellNavItems({
        activeKey: activeNav,
        onNavigate: runtimeScopeNavigation.pushWorkspace,
      }),
    [activeNav, runtimeScopeNavigation.pushWorkspace],
  );
  const historyItems = useMemo(
    () =>
      (homeSidebar.data?.threads || []).map((thread) => ({
        id: thread.id,
        title: getReferenceDisplayThreadTitle(thread.name),
        active: activeHistoryId ? thread.id === activeHistoryId : false,
        selector: thread.selector,
      })),
    [activeHistoryId, homeSidebar.data?.threads],
  );
  const contextValue = useMemo(
    () => ({
      embedded: true,
      refetchHistory: () => homeSidebar.refetch(),
    }),
    [homeSidebar],
  );

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <DolaAppShell
      navItems={navItems}
      historyItems={historyItems}
      historyLoading={homeSidebar.loading && historyItems.length === 0}
      onHistoryIntent={homeSidebar.ensureLoaded}
    >
      <PersistentShellProvider value={contextValue}>
        {children}
      </PersistentShellProvider>
    </DolaAppShell>
  );
}
