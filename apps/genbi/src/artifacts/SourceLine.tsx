import { Typography } from 'antd';
import { Link } from 'react-router-dom';
import { t } from '@/i18n/strings';
import type { ArtifactSource } from './types';

interface Props {
  source: ArtifactSource;
}

/** Where an artifact (or one dashboard tile) was derived from — a plain
 * label, or a link back to the originating Ask session. */
export function SourceLine({ source }: Props) {
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {t('artifacts.sourceLabel')}: {source.href ? <Link to={source.href}>{source.label}</Link> : source.label}
    </Typography.Text>
  );
}
