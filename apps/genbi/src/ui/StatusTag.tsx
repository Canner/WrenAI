import { Tag } from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import { brand } from '@/app/theme/tokens';
import { t } from '@/i18n/strings';

/**
 * Verified-first status tag. The verified state is the product's core
 * differentiator, so it is always rendered with BOTH a color and an icon+label
 * (a11y non-color channel) — never color alone.
 */
export type VerifiedState = 'verified' | 'estimate' | 'refused' | 'unverified';

const SPEC: Record<
  VerifiedState,
  { color: string; icon: React.ReactNode; label: string }
> = {
  verified: {
    color: brand.verified,
    icon: <CheckCircleOutlined />,
    label: t('status.verified'),
  },
  estimate: {
    color: brand.estimate,
    icon: <ExclamationCircleOutlined />,
    label: t('status.estimate'),
  },
  refused: {
    color: brand.refused,
    icon: <CloseCircleOutlined />,
    label: t('status.refused'),
  },
  unverified: {
    color: 'default',
    icon: <QuestionCircleOutlined />,
    label: t('status.unverified'),
  },
};

interface StatusTagProps {
  state: VerifiedState;
  /** Override the default label text. */
  label?: string;
}

export function StatusTag({ state, label }: StatusTagProps) {
  const spec = SPEC[state];
  return (
    <Tag color={spec.color} icon={spec.icon} bordered>
      {label ?? spec.label}
    </Tag>
  );
}

/** Map an envelope `verified` flag to a VerifiedState. */
export function verifiedStateOf(verified: boolean | null | undefined): VerifiedState {
  if (verified === true) return 'verified';
  if (verified === false) return 'unverified';
  return 'unverified';
}
