import { Tag } from 'antd';
import {
  CheckCircleOutlined,
  InfoCircleOutlined,
  WarningOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { brand, palette } from '@/app/theme/tokens';
import { t } from '@/i18n/strings';
import type { ImpactSeverity } from './types';

/**
 * Blast-radius severity, worst (`semantic`) to best (`none`). Always rendered
 * with BOTH a color and an icon+label (a11y non-color channel) — never color
 * alone — matching the `StatusTag` convention in `src/ui`.
 */
const SPEC: Record<ImpactSeverity, { color: string; icon: React.ReactNode; label: string }> = {
  semantic: {
    color: brand.refused,
    icon: <ThunderboltOutlined />,
    label: t('context.severitySemantic'),
  },
  structural: {
    color: brand.estimate,
    icon: <WarningOutlined />,
    label: t('context.severityStructural'),
  },
  compatibility: {
    color: palette.blue6,
    icon: <InfoCircleOutlined />,
    label: t('context.severityCompatibility'),
  },
  none: {
    color: brand.verified,
    icon: <CheckCircleOutlined />,
    label: t('context.severityNone'),
  },
};

interface SeverityTagProps {
  severity: ImpactSeverity;
}

export function SeverityTag({ severity }: SeverityTagProps) {
  const spec = SPEC[severity];
  return (
    <Tag color={spec.color} icon={spec.icon} bordered>
      {spec.label}
    </Tag>
  );
}
