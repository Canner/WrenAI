import type { Step } from './types';

/**
 * Derives a component's realization display label: `realizationKind` alone,
 * with `· split` appended when the component's steps span more than one
 * distinct tier (`new Set(steps.map(s => s.tier)).size > 1`), and `·
 * scheduled` appended when the component's `trigger` is `"scheduled"` (a
 * resident, cadence-driven component rather than a one-shot skill/tool).
 * Shared by the live BFF mapping (`bff/client.ts`) and the fixtures
 * (`fixtures.ts`) so the two can never drift.
 */
export function deriveRealizationLabel(realizationKind: string, steps: readonly Step[], trigger: string): string {
  const distinctTiers = new Set(steps.map((step) => step.tier));
  const parts = [realizationKind];
  if (distinctTiers.size > 1) parts.push('split');
  if (trigger === 'scheduled') parts.push('scheduled');
  return parts.join(' · ');
}
