import { Typography } from 'antd';
import { Panel, StatusTag } from '@/ui';
import { t } from '@/i18n/strings';
import type { RefusalEvent } from '../types';

interface Props {
  event: RefusalEvent;
}

/** An honest decline: reason + how to unblock it — never a fabricated number. */
export function RefusalCard({ event }: Props) {
  return (
    <Panel title={<StatusTag state="refused" />}>
      <Typography.Paragraph style={{ marginBottom: 8 }}>{event.reason}</Typography.Paragraph>
      <Typography.Text type="secondary">
        {t('ask.refusalFixLabel')}: {event.fix}
      </Typography.Text>
    </Panel>
  );
}
