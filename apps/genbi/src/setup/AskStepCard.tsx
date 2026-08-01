import { Link } from 'react-router-dom';
import { Button, Space } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import { Panel } from '@/ui';
import { t } from '@/i18n/strings';

/**
 * Step 5 (Ask): setup's terminal step. Shown once "Bind profile" completes;
 * offers a CTA into the real `/ask` route. The verify gate is an internal
 * bind-time detail (surfaced on the Bind step), not something to re-show here.
 */
export function AskStepCard() {
  return (
    <Panel title={t('setup.askTitle')} note={t('setup.askDescription')}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Link to="/ask">
          <Button type="primary" icon={<ArrowRightOutlined />}>
            {t('setup.askCta')}
          </Button>
        </Link>
      </Space>
    </Panel>
  );
}
