import { Tag } from 'antd';
import { CheckCircleOutlined, WarningOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { brand } from '@/app/theme/tokens';
import { t } from '@/i18n/strings';
import type { ConnectionHealth } from './types';

/**
 * Data-source connection health, always rendered with BOTH a color and an
 * icon+label (a11y non-color channel) — never color alone.
 */
const SPEC: Record<ConnectionHealth, { color: string; icon: React.ReactNode; label: string }> = {
  healthy: {
    color: brand.verified,
    icon: <CheckCircleOutlined />,
    label: t('harness.healthHealthy'),
  },
  degraded: {
    color: brand.estimate,
    icon: <WarningOutlined />,
    label: t('harness.healthDegraded'),
  },
  down: {
    color: brand.refused,
    icon: <CloseCircleOutlined />,
    label: t('harness.healthDown'),
  },
};

interface ConnectionHealthTagProps {
  health: ConnectionHealth;
}

export function ConnectionHealthTag({ health }: ConnectionHealthTagProps) {
  const spec = SPEC[health];
  return (
    <Tag color={spec.color} icon={spec.icon} bordered>
      {spec.label}
    </Tag>
  );
}
