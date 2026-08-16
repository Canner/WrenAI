import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Space, Typography } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import { Panel } from '@/ui';
import { t } from '@/i18n/strings';
import { useSessionStore } from '@/session/useSessionStore';
import { structuredAskPath } from '@/sessions/structuredAsk';

/**
 * Step 5 (Ask): setup's terminal step. Shown once "Bind profile" completes;
 * opens a persisted Structured Ask session in the Sessions workbench. The verify gate is an internal
 * bind-time detail (surfaced on the Bind step), not something to re-show here.
 */
export function AskStepCard() {
  const navigate = useNavigate();
  const startStructuredSession = useSessionStore((state) => state.startStructuredSession);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const openStructuredAsk = async () => {
    setStarting(true); setError(undefined);
    try {
      navigate(structuredAskPath(await startStructuredSession()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'A Structured Ask session could not be created.');
    } finally { setStarting(false); }
  };
  return (
    <Panel title={t('setup.askTitle')} note={t('setup.askDescription')}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Button type="primary" icon={<ArrowRightOutlined />} loading={starting} onClick={() => void openStructuredAsk()}>
          {t('setup.askCta')}
        </Button>
        {error ? <Typography.Text type="danger" role="alert">{error}</Typography.Text> : null}
      </Space>
    </Panel>
  );
}
