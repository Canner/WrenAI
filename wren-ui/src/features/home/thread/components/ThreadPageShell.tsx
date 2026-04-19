import type { ReactNode } from 'react';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { buildNovaShellNavItems } from '@/components/reference/novaShellNavigation';

type ThreadPageShellProps = {
  threadId?: number | null;
  title?: string | null;
  loading: boolean;
  onNavigate: (href: string) => Promise<unknown> | unknown;
  children?: ReactNode;
};

export default function ThreadPageShell({
  threadId,
  title,
  loading,
  onNavigate,
  children,
}: ThreadPageShellProps) {
  return (
    <ConsoleShellLayout
      activeNav="home"
      activeHistoryId={threadId ? String(threadId) : null}
      title={title}
      hideHeader
      contentBorderless
      loading={loading}
      navItems={buildNovaShellNavItems({
        activeKey: 'home',
        onNavigate,
      })}
    >
      {children}
    </ConsoleShellLayout>
  );
}
