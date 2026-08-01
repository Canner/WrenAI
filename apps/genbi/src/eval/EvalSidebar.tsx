import type { SidebarItem } from '@/fixtures';
import { SidebarList } from '@/app/shell/SidebarList';
import { t } from '@/i18n/strings';
import { useEvalStore } from './useEvalStore';

/**
 * Eval page's contextual sidebar: the last N eval runs. Reuses the generic
 * `SidebarList`, wired to `useEvalStore` so selection drives the canvas
 * (`EvalPage`) — same controlled-selection pattern as `HarnessSidebar`. The
 * run list itself comes from the store (fixtures by default, live once the
 * BFF loads them), so this component just renders whatever it has.
 */
export function EvalSidebar() {
  const selectedRunId = useEvalStore((s) => s.selectedRunId);
  const selectRun = useEvalStore((s) => s.selectRun);
  const runs = useEvalStore((s) => s.runs);

  const items: SidebarItem[] = runs.map((run) => ({
    key: run.id,
    label: run.id,
    meta: `${run.score.toFixed(2)} · ${run.gatePass ? t('eval.gatePass') : t('eval.gateFail')}`,
  }));

  return (
    <SidebarList
      header={t('eval.runsHeader')}
      items={items}
      selectedKey={selectedRunId}
      onSelect={selectRun}
    />
  );
}
