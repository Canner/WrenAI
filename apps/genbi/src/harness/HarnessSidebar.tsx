import type { SidebarItem } from '@/fixtures';
import { SidebarList } from '@/app/shell/SidebarList';
import { t } from '@/i18n/strings';
import { HARNESS_PURPOSES, useHarnessStore } from './useHarnessStore';

/**
 * Harness page's contextual sidebar: a profile selector, not a per-agent
 * list. There is only ever one bound profile today — its declared agents
 * live in the Components table on the canvas, not here (see spec). Phase-3
 * spawnable sub-agent profiles show as disabled placeholders ahead of that
 * capability landing. Reuses the generic `SidebarList`, wired to
 * `useHarnessStore` so selection drives the canvas (`HarnessPage`).
 */
export function HarnessSidebar() {
  const selectedPurpose = useHarnessStore((s) => s.selectedPurpose);
  const selectProfile = useHarnessStore((s) => s.selectProfile);
  const harness = useHarnessStore((s) => s.harness);

  const labels: Record<typeof HARNESS_PURPOSES[number], string> = {
    setup: 'Setup',
    analysis: 'Analyze data',
    context_enrichment: 'Context enrichment',
  };
  const items: SidebarItem[] = HARNESS_PURPOSES.map((purpose) => ({
    key: purpose,
    label: labels[purpose],
    meta: harness?.purpose.purpose === purpose ? harness.purpose.profile : undefined,
  }));

  return (
    <SidebarList
      header={t('harness.profilesHeader')}
      items={items}
      selectedKey={selectedPurpose}
      onSelect={(key) => selectProfile(key as typeof HARNESS_PURPOSES[number])}
    />
  );
}
