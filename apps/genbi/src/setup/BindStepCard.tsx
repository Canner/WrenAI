import { Button, Space, Tag } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { Panel, KVRow } from '@/ui';
import { brand } from '@/app/theme/tokens';
import { t } from '@/i18n/strings';
import { useSetupStore } from './useSetupStore';

/**
 * Step 4 (Bind profile): compile the built context into a profile and turn
 * the verify gate on. "Compile and bind" marks this step done, flips
 * `verifyGate` true, and advances the flow to "Ask" — the same verify-gate
 * on/off Tag convention used on the Harness page (`HarnessOverview`).
 */
export function BindStepCard() {
  const verifyGate = useSetupStore((s) => s.verifyGate);
  const compileAndBind = useSetupStore((s) => s.compileAndBind);

  return (
    <Panel
      title={t('setup.bindTitle')}
      note={verifyGate ? t('setup.bindDoneNote') : t('setup.bindDescription')}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <KVRow
          label={t('setup.bindVerifyGateLabel')}
          value={
            <Tag
              color={verifyGate ? brand.verified : brand.refused}
              icon={verifyGate ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
              bordered
            >
              {verifyGate ? t('setup.bindVerifyGateOn') : t('setup.bindVerifyGateOff')}
            </Tag>
          }
        />
        <Button type="primary" onClick={compileAndBind} disabled={verifyGate}>
          {t('setup.bindAction')}
        </Button>
      </Space>
    </Panel>
  );
}
