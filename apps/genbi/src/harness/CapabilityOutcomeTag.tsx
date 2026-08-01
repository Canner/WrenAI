import { Tag } from 'antd';
import { CheckCircleOutlined, ApiOutlined } from '@ant-design/icons';
import { brand } from '@/app/theme/tokens';
import { t } from '@/i18n/strings';
import type { CapabilityOutcome } from './types';

/**
 * Capability resolution outcome, always rendered with BOTH a color and an
 * icon+label (a11y non-color channel) — matching the `SeverityTag` /
 * `StatusTag` convention.
 */
const SPEC: Record<CapabilityOutcome, { color: string; icon: React.ReactNode; label: string }> = {
  native: {
    color: brand.verified,
    icon: <CheckCircleOutlined />,
    label: t('harness.outcomeNative'),
  },
  'realize-via': {
    color: brand.estimate,
    icon: <ApiOutlined />,
    label: t('harness.outcomeRealizeVia'),
  },
};

interface CapabilityOutcomeTagProps {
  outcome: CapabilityOutcome;
}

export function CapabilityOutcomeTag({ outcome }: CapabilityOutcomeTagProps) {
  const spec = SPEC[outcome];
  return (
    <Tag color={spec.color} icon={spec.icon} bordered>
      {spec.label}
    </Tag>
  );
}
