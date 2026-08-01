import { Tag } from 'antd';
import { CheckCircleOutlined, SyncOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { brand } from '@/app/theme/tokens';
import { t } from '@/i18n/strings';
import type { StepState } from './types';

/**
 * Setup step progress, always rendered with BOTH a color and an icon+label
 * (a11y non-color channel) — matching `GateStatusTag` / `CapabilityOutcomeTag`.
 */
const SPEC: Record<StepState, { color?: string; icon: React.ReactNode; label: string }> = {
  done: {
    color: brand.verified,
    icon: <CheckCircleOutlined />,
    label: t('setup.stepDone'),
  },
  current: {
    color: brand.estimate,
    icon: <SyncOutlined />,
    label: t('setup.stepCurrent'),
  },
  todo: {
    icon: <ClockCircleOutlined />,
    label: t('setup.stepTodo'),
  },
};

interface StepStatusTagProps {
  state: StepState;
}

export function StepStatusTag({ state }: StepStatusTagProps) {
  const spec = SPEC[state];
  return (
    <Tag color={spec.color} icon={spec.icon} bordered>
      {spec.label}
    </Tag>
  );
}
