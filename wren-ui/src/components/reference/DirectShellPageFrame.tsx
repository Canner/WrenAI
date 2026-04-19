import type { ReactNode } from 'react';
import { useMemo } from 'react';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { getReferenceDisplayThreadTitle } from '@/utils/referenceDemoKnowledge';
import {
  buildNovaShellNavItems,
  type NovaShellNavKey,
} from './novaShellNavigation';
import DolaAppShell from './DolaAppShell';
import { usePersistentShellEmbedded } from './PersistentShellContext';

type Props = {
  activeNav: NovaShellNavKey;
  children: ReactNode;
};

export default function DirectShellPageFrame({ activeNav, children }: Props) {
  const embedded = usePersistentShellEmbedded();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const homeSidebar = useHomeSidebar({
    deferInitialLoad: false,
    loadOnIntent: false,
    disabled: embedded,
  });

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
        active: false,
        selector: thread.selector,
      })),
    [homeSidebar.data?.threads],
  );

  if (embedded) {
    return <>{children}</>;
  }

  return (
    <DolaAppShell
      navItems={navItems}
      historyItems={historyItems}
      historyLoading={homeSidebar.loading && historyItems.length === 0}
      onHistoryIntent={homeSidebar.ensureLoaded}
    >
      {children}
    </DolaAppShell>
  );
}
