import { Button, Typography } from 'antd';
import { LinkOutlined, ShareAltOutlined } from '@ant-design/icons';
import { KVRow, Panel } from '@/ui';
import { t } from '@/i18n/strings';
import type { ArtifactPublish } from './types';

interface Props {
  publish?: ArtifactPublish;
  onPublish: () => void;
}

/** Publish status for one artifact: an unpublished CTA, or the recorded
 * share link + access scope. Same shape as the Ask session's
 * `ArtifactCard`/`PublishedCard`, reused here as the artifact-level
 * "shared/published" indicator.
 *
 * The share link is shown greyed out and NOT as an anchor: sharing isn't
 * implemented yet, and the link the server records is a placeholder on a
 * reserved `.example` domain that can never resolve. Rendering it as a
 * clickable link promised a working share URL that would always fail to
 * open. Restore the anchor once publishing actually hosts the artifact. */
export function PublishStatus({ publish, onPublish }: Props) {
  return (
    <Panel
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <LinkOutlined aria-hidden="true" />
          {t('artifacts.publishTitle')}
        </span>
      }
      extra={
        !publish && (
          <Button size="small" type="primary" icon={<ShareAltOutlined />} onClick={onPublish}>
            {t('artifacts.publish')}
          </Button>
        )
      }
    >
      {publish ? (
        <>
          <KVRow
            label={t('artifacts.shareLink')}
            value={<Typography.Text type="secondary">{publish.link}</Typography.Text>}
          />
          <KVRow label={t('artifacts.accessScope')} value={publish.scope} />
          <Typography.Text type="secondary">{t('artifacts.shareLinkPending')}</Typography.Text>
        </>
      ) : (
        <Typography.Text type="secondary">{t('artifacts.notPublished')}</Typography.Text>
      )}
    </Panel>
  );
}
