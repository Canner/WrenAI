import { Tag } from 'antd';
import { brand } from '@/app/theme/tokens';
import { t } from '@/i18n/strings';
import type { Step } from './types';

interface StepDataflowProps {
  steps: Step[];
}

/**
 * Read-only step→artifact dataflow for one component's `steps[]` — the same
 * `consumes` list the executor treats as a hard precondition. A
 * `repair_fold` step is visually distinct (colored realization tag) and
 * shows what it folds back into.
 */
export function StepDataflow({ steps }: StepDataflowProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
      {steps.map((step) => (
        <div key={step.name} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <Tag bordered>{step.tier}</Tag>
          <strong>{step.name}</strong>
          <span style={{ opacity: 0.65, fontSize: 12 }}>
            {t('harness.stepConsumes')}: {step.consumes.length > 0 ? step.consumes.join(', ') : '—'} →{' '}
            {t('harness.stepProduces')}: {step.produces}
          </span>
          <Tag color={step.realization === 'repair_fold' ? brand.estimate : undefined} bordered>
            {step.realization}
          </Tag>
          {step.guard && (
            <Tag bordered>
              {t('harness.stepGuard')}: {step.guard}
            </Tag>
          )}
          {step.realization === 'repair_fold' && (
            <span style={{ opacity: 0.65, fontSize: 12 }}>
              {t('harness.stepFoldInto')}: {step.foldInto} · {t('harness.stepMaxAttempts')}: {step.maxAttempts}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
