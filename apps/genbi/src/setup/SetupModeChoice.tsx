import { Button, Card, Space, Spin, Typography } from 'antd';
import { Alert } from 'antd';
import { Panel } from '@/ui';
import { t } from '@/i18n/strings';
import { useSetupStore } from './useSetupStore';

/**
 * The wizard's entry-path choice, shown once (live mode only) before any step
 * renders: "Create a new project" (unchanged scaffold flow) vs. "Adopt an
 * existing project" (verify + bind an existing directory). Gated in
 * `SetupPage`/`SetupSidebar` on `isBffEnabled() && !setupMode` — fixture mode
 * never reaches this component.
 */
export function SetupModeChoice() {
  const setupModeLoading = useSetupStore((s) => s.setupModeLoading);
  const setupModeChoosing = useSetupStore((s) => s.setupModeChoosing);
  const setupModeError = useSetupStore((s) => s.setupModeError);
  const chooseSetupMode = useSetupStore((s) => s.chooseSetupMode);

  if (setupModeLoading) {
    return (
      <Panel title={t('setup.modeChoiceTitle')}>
        <Spin />
      </Panel>
    );
  }

  return (
    <Panel title={t('setup.modeChoiceTitle')} note={t('setup.modeChoiceDescription')}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card size="small">
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Typography.Text strong>{t('setup.modeCreateTitle')}</Typography.Text>
            <Typography.Text type="secondary">{t('setup.modeCreateDescription')}</Typography.Text>
            <Button
              type="primary"
              disabled={setupModeChoosing}
              loading={setupModeChoosing}
              onClick={() => chooseSetupMode('create')}
            >
              {t('setup.modeCreateAction')}
            </Button>
          </Space>
        </Card>
        <Card size="small">
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Typography.Text strong>{t('setup.modeAdoptTitle')}</Typography.Text>
            <Typography.Text type="secondary">{t('setup.modeAdoptDescription')}</Typography.Text>
            <Button
              disabled={setupModeChoosing}
              loading={setupModeChoosing}
              onClick={() => chooseSetupMode('adopt')}
            >
              {t('setup.modeAdoptAction')}
            </Button>
          </Space>
        </Card>
        {setupModeError && <Alert type="error" showIcon message={setupModeError} />}
      </Space>
    </Panel>
  );
}
