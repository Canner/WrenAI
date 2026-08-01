import { Typography } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import { KVRow, Panel } from '@/ui';
import { t } from '@/i18n/strings';
import type { PublishedEvent } from '../types';

interface Props {
  event: PublishedEvent;
}

/** The result of publishing an artifact: the recorded share link plus its
 * access scope. The link is greyed out and NOT an anchor — sharing isn't
 * implemented yet and the recorded link is a placeholder on a reserved
 * `.example` domain that can never resolve, so presenting it as clickable
 * promised a share URL that would always fail to open. Mirrors
 * `artifacts/PublishStatus`; restore the anchor once publishing really hosts
 * the artifact. */
export function PublishedCard({ event }: Props) {
  return (
    <Panel
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <LinkOutlined aria-hidden="true" />
          {t('ask.publishedTitle')}
        </span>
      }
    >
      <KVRow label={t('ask.artifact')} value={event.artifactName} />
      <KVRow
        label={t('ask.shareLink')}
        value={<Typography.Text type="secondary">{event.link}</Typography.Text>}
      />
      <KVRow label={t('ask.accessScope')} value={event.scope} />
      <Typography.Text type="secondary">{t('ask.shareLinkPending')}</Typography.Text>
    </Panel>
  );
}
