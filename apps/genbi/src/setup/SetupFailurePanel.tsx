import { Alert, Button, Collapse, Space, Typography } from 'antd';
import { t } from '@/i18n/strings';
import { WorkLog } from '@/session/WorkLog';
import type { SetupFailureRecovery } from './types';

interface SetupFailurePanelProps {
  failure: SetupFailureRecovery;
  step: 'connect' | 'context';
  retrying: boolean;
  onRetry: () => void;
}

/**
 * Friendly failure state shared by connect and context. Provider/host
 * diagnostics never become its primary copy; the BFF-provided redacted
 * diagnostic and work log remain available on demand for troubleshooting.
 */
export function SetupFailurePanel({ failure, step, retrying, onRetry }: SetupFailurePanelProps) {
  const title = step === 'connect' ? t('setup.connectFailureTitle') : t('setup.contextFailureTitle');
  const description = step === 'connect' ? t('setup.connectFailureDescription') : t('setup.contextFailureDescription');
  return (
    <Alert
      type="error"
      showIcon
      message={title}
      description={
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text>{description}</Typography.Text>
          <Typography.Text type="secondary">
            {t('setup.failureProjectSource')}{failure.projectName} · {failure.sourceType}
          </Typography.Text>
          <Button type="primary" onClick={onRetry} loading={retrying} disabled={retrying}>
            {t('setup.continueAndRepair')}
          </Button>
          <Collapse
            size="small"
            items={[{
              key: 'technical-details',
              label: t('setup.failureTechnicalDetails'),
              children: (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{failure.error}</Typography.Paragraph>
                  <WorkLog steps={failure.workLog} />
                </Space>
              ),
            }]}
          />
        </Space>
      }
    />
  );
}
