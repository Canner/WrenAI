import { Button, Typography } from 'antd';
import { AppstoreOutlined, SaveOutlined, ShareAltOutlined } from '@ant-design/icons';
import { PUBLISH_UI_ENABLED } from '@/app/features';
import { Panel } from '@/ui';
import { t } from '@/i18n/strings';
import type { ArtifactEvent } from '../types';

interface Props {
  event: ArtifactEvent;
  /** Whether this artifact has already been saved to the Artifacts page. */
  saved: boolean;
  onSave: () => void;
  /** Whether a PublishedEvent already exists for this artifact in the thread. */
  published: boolean;
  onPublish: () => void;
}

/** A produced output, with the location it was written to. The user must
 * explicitly save it (below) before it appears on the Artifacts page — an
 * agent-produced artifact is not auto-listed. Saving is independent of, and
 * never gated behind, `PUBLISH_UI_ENABLED`: that flag hides only the separate
 * publish-a-link feature, which stays unimplemented and hidden. */
export function ArtifactCard({ event, saved, onSave, published, onPublish }: Props) {
  return (
    <Panel
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <AppstoreOutlined aria-hidden="true" />
          {event.name}
        </span>
      }
      extra={
        <div style={{ display: 'inline-flex', gap: 8 }}>
          <Button
            size="small"
            type={saved ? 'default' : 'primary'}
            icon={<SaveOutlined />}
            disabled={saved}
            onClick={onSave}
          >
            {saved ? t('ask.saved') : t('ask.save')}
          </Button>
          {PUBLISH_UI_ENABLED ? (
            <Button
              size="small"
              type={published ? 'default' : 'primary'}
              icon={<ShareAltOutlined />}
              disabled={published}
              onClick={onPublish}
            >
              {published ? t('ask.published') : t('ask.publish')}
            </Button>
          ) : undefined}
        </div>
      }
    >
      <Typography.Text type="secondary">{event.location}</Typography.Text>
    </Panel>
  );
}
