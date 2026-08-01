import type { SidebarItem } from '@/fixtures';
import { SidebarList } from '@/app/shell/SidebarList';
import { t } from '@/i18n/strings';
import { isBffEnabled } from '@/bff/env';
import { BOUND_PROFILE_KEY, useHarnessStore } from './useHarnessStore';
import { fixtureHarnessView } from './fixtures';

/**
 * Harness page's contextual sidebar: a profile selector, not a per-agent
 * list. There is only ever one bound profile today — its declared agents
 * live in the Components table on the canvas, not here (see spec). Phase-3
 * spawnable sub-agent profiles show as disabled placeholders ahead of that
 * capability landing. Reuses the generic `SidebarList`, wired to
 * `useHarnessStore` so selection drives the canvas (`HarnessPage`).
 */
export function HarnessSidebar() {
  const selectedProfileKey = useHarnessStore((s) => s.selectedProfileKey);
  const selectProfile = useHarnessStore((s) => s.selectProfile);
  const harness = useHarnessStore((s) => s.harness);

  const live = isBffEnabled();
  const view = live ? harness : fixtureHarnessView;

  const placeholders = (view?.agentProfiles ?? [])
    .filter((profile) => profile.role === 'sub-agent')
    .map((profile) => ({ key: `planned:${profile.name}`, label: profile.name, meta: profile.status, disabled: true }));

  const items: SidebarItem[] = [
    ...(view ? [{ key: BOUND_PROFILE_KEY, label: view.profile.name, meta: t('harness.profileStatusBound') }] : []),
    ...placeholders,
  ];

  return (
    <SidebarList
      header={t('harness.profilesHeader')}
      items={items}
      selectedKey={selectedProfileKey}
      onSelect={selectProfile}
    />
  );
}
