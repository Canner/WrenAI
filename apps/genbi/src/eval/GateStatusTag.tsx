import { Tag } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { brand } from '@/app/theme/tokens';
import { t } from '@/i18n/strings';

interface GateStatusTagProps {
  pass: boolean;
}

/**
 * Eval gate pass/fail, always rendered with BOTH a color and an icon+label
 * (a11y non-color channel) — matching `ConnectionHealthTag` /
 * `CapabilityOutcomeTag`.
 */
export function GateStatusTag({ pass }: GateStatusTagProps) {
  return (
    <Tag
      color={pass ? brand.verified : brand.refused}
      icon={pass ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
      bordered
    >
      {pass ? t('eval.gatePass') : t('eval.gateFail')}
    </Tag>
  );
}
